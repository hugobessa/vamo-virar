use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use community_node::store::Store;
use community_node::{service, App, Config};
use tracing_subscriber::EnvFilter;

const USAGE: &str = "\
community-node — vamo-virar community node

USAGE:
    community-node [serve] [--config <file.toml>] [--listen <addr>] [--data-dir <dir>]
    community-node health [--url <http://host:port>]
    community-node backup --out <file> [--config <file.toml>] [--data-dir <dir>]
    community-node tenant-token
    community-node --version

serve (default)  Run the node. Options override the config file; the
                 environment variables VV_LISTEN, VV_DATA_DIR,
                 VV_PROVISIONING_TOKEN, VV_TRUST_FORWARDED_FOR,
                 VV_OPERATOR_LISTEN and VV_OPERATOR_TOKEN override both.
health           Exit 0 if the node at --url (default http://127.0.0.1:8787)
                 answers. For container health checks.
backup           Write a consistent copy of the node's database to --out,
                 safely while the node is running.
tenant-token     Managed hosting: print a new tenant provisioning token and
                 the token_sha256 line for its [[tenants]] entry.

Set RUST_LOG=info (or debug) for logs.";

struct Args {
    cmd: String,
    config: Config,
    url: String,
    out: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut args = std::env::args().skip(1).peekable();
    let cmd = match args.peek().map(String::as_str) {
        Some("serve" | "health" | "backup" | "tenant-token") => args.next().unwrap(),
        _ => "serve".to_owned(),
    };
    let (mut config_path, mut listen, mut data_dir, mut out) = (None::<PathBuf>, None, None, None);
    let mut url = "http://127.0.0.1:8787".to_owned();
    while let Some(a) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        match a.as_str() {
            "--config" => config_path = Some(value("--config")?.into()),
            "--listen" => listen = Some(value("--listen")?),
            "--data-dir" => data_dir = Some(PathBuf::from(value("--data-dir")?)),
            "--url" => url = value("--url")?,
            "--out" => out = Some(PathBuf::from(value("--out")?)),
            "-V" | "--version" => {
                return Err(format!("community-node {}", env!("CARGO_PKG_VERSION")))
            }
            "-h" | "--help" => return Err(USAGE.into()),
            other => return Err(format!("unknown argument {other}\n\n{USAGE}")),
        }
    }
    let mut config = match config_path {
        Some(p) => {
            let text =
                std::fs::read_to_string(&p).map_err(|e| format!("reading {}: {e}", p.display()))?;
            toml::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))?
        }
        None => Config::default(),
    };
    if let Some(l) = listen {
        config.listen = l;
    }
    if let Some(d) = data_dir {
        config.data_dir = d;
    }
    if let Ok(v) = std::env::var("VV_LISTEN") {
        config.listen = v;
    }
    if let Ok(v) = std::env::var("VV_DATA_DIR") {
        config.data_dir = v.into();
    }
    if let Ok(v) = std::env::var("VV_TRUST_FORWARDED_FOR") {
        config.trust_forwarded_for = matches!(v.as_str(), "1" | "true" | "yes");
    }
    if let Ok(t) = std::env::var("VV_PROVISIONING_TOKEN") {
        if !t.is_empty() {
            config.provisioning_token = Some(t);
        }
    }
    if let Ok(v) = std::env::var("VV_OPERATOR_LISTEN") {
        if !v.is_empty() {
            config.operator_listen = Some(v);
        }
    }
    if let Ok(t) = std::env::var("VV_OPERATOR_TOKEN") {
        if !t.is_empty() {
            config.operator_token = Some(t);
        }
    }
    config.validate()?;
    Ok(Args {
        cmd,
        config,
        url,
        out,
    })
}

/// Minimal HTTP/1.1 GET of the discovery document, without an HTTP client crate.
async fn health(url: &str) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let rest = url
        .strip_prefix("http://")
        .ok_or("health check supports http:// URLs only")?;
    let host = rest.split('/').next().unwrap_or(rest);
    let mut stream =
        tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(host))
            .await
            .map_err(|_| "timed out connecting".to_owned())?
            .map_err(|e| format!("connect {host}: {e}"))?;
    let req = format!(
        "GET /.well-known/vamo-virar HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut buf))
        .await
        .map_err(|_| "timed out reading".to_owned())?
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    if text.starts_with("HTTP/1.1 200") && text.contains("\"protocol\":\"vv/0\"") {
        Ok(())
    } else {
        Err(format!(
            "unexpected response: {}",
            text.lines().next().unwrap_or("")
        ))
    }
}

fn backup(data_dir: &Path, out: &Path) -> Result<(), String> {
    let src = rusqlite::Connection::open_with_flags(
        data_dir.join("node.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("open database: {e}"))?;
    let mut dst =
        rusqlite::Connection::open(out).map_err(|e| format!("open {}: {e}", out.display()))?;
    let b = rusqlite::backup::Backup::new(&src, &mut dst).map_err(|e| e.to_string())?;
    b.run_to_completion(256, Duration::from_millis(10), None)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args = match parse_args() {
        Ok(a) => a,
        Err(msg) => {
            let ok = msg.starts_with("community-node ");
            eprintln!("{msg}");
            std::process::exit(if ok { 0 } else { 2 });
        }
    };
    match args.cmd.as_str() {
        "health" => match health(&args.url).await {
            Ok(()) => std::process::exit(0),
            Err(e) => {
                eprintln!("unhealthy: {e}");
                std::process::exit(1);
            }
        },
        "tenant-token" => {
            let token = community_node::app::hex(&community_node::app::random::<32>());
            let digest = <sha2::Sha256 as sha2::Digest>::digest(token.as_bytes());
            println!("token (give this to the tenant): {token}");
            println!(
                "config line:  token_sha256 = \"{}\"",
                community_node::app::hex(&digest)
            );
            return;
        }
        "backup" => {
            let Some(out) = args.out else {
                eprintln!("backup needs --out <file>");
                std::process::exit(2);
            };
            match backup(&args.config.data_dir, &out) {
                Ok(()) => println!("backup written to {}", out.display()),
                Err(e) => {
                    eprintln!("backup failed: {e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        _ => {}
    }

    #[cfg(feature = "test-clock")]
    eprintln!("WARNING: built with the test-clock feature; never deploy this binary");
    let config = args.config;
    if let Err(e) = std::fs::create_dir_all(&config.data_dir) {
        eprintln!("cannot create {}: {e}", config.data_dir.display());
        std::process::exit(1);
    }
    let db = config.data_dir.join("node.sqlite");
    let store = Store::open(&db).unwrap_or_else(|e| {
        eprintln!("cannot open {}: {e}", db.display());
        std::process::exit(1);
    });
    if config.provisioning_token.is_none()
        && !config.open_provisioning
        && config.tenants.is_empty()
        && config.operator_listen.is_none()
    {
        tracing::warn!(
            "provisioning is closed: set VV_PROVISIONING_TOKEN to allow creating communities"
        );
    }
    let listen = config.listen.clone();
    let operator_listen = config.operator_listen.clone();
    let app = Arc::new(App::new(config, store).expect("initialise node identity"));

    if let Some(addr) = operator_listen {
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .unwrap_or_else(|e| {
                eprintln!("cannot listen on {addr} (operator API): {e}");
                std::process::exit(1);
            });
        println!(
            "operator API listening on {}",
            listener.local_addr().map(|a| a.to_string()).unwrap_or(addr)
        );
        let op = community_node::operator_service(app.clone());
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, op).await {
                tracing::error!(error = %e, "operator API stopped");
            }
        });
    }

    let hk = app.clone();
    let every = Duration::from_secs(app.config.housekeeping_interval_secs.max(1));
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        loop {
            tick.tick().await;
            if let Err(e) = hk.housekeeping() {
                tracing::error!(error = %e, "housekeeping failed");
            }
        }
    });

    let listener = tokio::net::TcpListener::bind(&listen)
        .await
        .unwrap_or_else(|e| {
            eprintln!("cannot listen on {listen}: {e}");
            std::process::exit(1);
        });
    let addr = listener
        .local_addr()
        .map(|a| a.to_string())
        .unwrap_or(listen);
    // A machine-readable line so scripts and tests can find the bound port.
    println!(
        "community-node listening on {addr} node_id={}",
        community_node::app::hex(&app.node_id)
    );
    let shutdown = async {
        let ctrl_c = async {
            let _ = tokio::signal::ctrl_c().await;
        };
        #[cfg(unix)]
        let term = async {
            if let Ok(mut s) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                s.recv().await;
            }
        };
        #[cfg(not(unix))]
        let term = std::future::pending::<()>();
        tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    };
    axum::serve(
        listener,
        service(app).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .expect("server error");
}
