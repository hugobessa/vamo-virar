use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use community_node::store::Store;
use community_node::{service, App, Config};
use tracing_subscriber::EnvFilter;

const USAGE: &str = "\
community-node — vamo-virar community node

USAGE:
    community-node [--config <file.toml>] [--listen <addr>] [--data-dir <dir>]

Options override the config file. Without a config file, defaults are used:
listen 127.0.0.1:8787, data dir ./data, provisioning closed.
Set RUST_LOG=info (or debug) for logs.";

fn parse_args() -> Result<Config, String> {
    let mut args = std::env::args().skip(1);
    let mut config_path: Option<PathBuf> = None;
    let mut listen = None;
    let mut data_dir = None;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--config" => config_path = Some(args.next().ok_or("--config needs a value")?.into()),
            "--listen" => listen = Some(args.next().ok_or("--listen needs a value")?),
            "--data-dir" => {
                data_dir = Some(PathBuf::from(
                    args.next().ok_or("--data-dir needs a value")?,
                ))
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
    if let Ok(t) = std::env::var("VV_PROVISIONING_TOKEN") {
        config.provisioning_token = Some(t);
    }
    Ok(config)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let config = match parse_args() {
        Ok(c) => c,
        Err(msg) => {
            eprintln!("{msg}");
            std::process::exit(2);
        }
    };
    if let Err(e) = std::fs::create_dir_all(&config.data_dir) {
        eprintln!("cannot create {}: {e}", config.data_dir.display());
        std::process::exit(1);
    }
    let db = config.data_dir.join("node.sqlite");
    let store = Store::open(&db).unwrap_or_else(|e| {
        eprintln!("cannot open {}: {e}", db.display());
        std::process::exit(1);
    });
    let listen = config.listen.clone();
    let app = Arc::new(App::new(config, store).expect("initialise node identity"));

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
    axum::serve(
        listener,
        service(app).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .expect("server error");
}
