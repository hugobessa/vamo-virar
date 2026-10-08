//! Strict deterministic CBOR (RFC 8949 §4.2.1), the same subset and rules as
//! `packages/protocol/src/cbor.ts`: integers within ±(2^53 − 1), byte and
//! text strings, arrays, text-keyed maps, booleans and null. The decoder
//! rejects anything the encoder would not produce.

use thiserror::Error;

pub const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;
const MAX_DEPTH: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Int(i64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Value>),
    /// Entries in canonical order once decoded; `encode` sorts regardless.
    Map(Vec<(String, Value)>),
    Bool(bool),
    Null,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CborError {
    #[error("unexpected end of input")]
    Eof,
    #[error("trailing bytes")]
    Trailing,
    #[error("non-shortest integer encoding")]
    NonShortest,
    #[error("integer outside the safe range")]
    OutOfRange,
    #[error("unsupported item (indefinite length, tag, float or simple value)")]
    Unsupported,
    #[error("invalid UTF-8")]
    Utf8,
    #[error("map keys must be text, unique and in canonical order")]
    MapKeys,
    #[error("nesting too deep")]
    Depth,
}

impl Value {
    pub fn map<K: Into<String>>(entries: impl IntoIterator<Item = (K, Value)>) -> Value {
        Value::Map(entries.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Map(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Value::Bytes(b) => Some(b),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_uint(&self) -> Option<u64> {
        match self {
            Value::Int(n) if *n >= 0 => Some(*n as u64),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

fn head(out: &mut Vec<u8>, major: u8, arg: u64) {
    let m = major << 5;
    if arg < 24 {
        out.push(m | arg as u8);
    } else if arg < 0x100 {
        out.extend_from_slice(&[m | 24, arg as u8]);
    } else if arg < 0x1_0000 {
        out.push(m | 25);
        out.extend_from_slice(&(arg as u16).to_be_bytes());
    } else if arg < 0x1_0000_0000 {
        out.push(m | 26);
        out.extend_from_slice(&(arg as u32).to_be_bytes());
    } else {
        out.push(m | 27);
        out.extend_from_slice(&arg.to_be_bytes());
    }
}

/// Encodes `v` deterministically.
///
/// # Panics
/// If an integer lies outside ±(2^53 − 1); such values cannot be produced by
/// `decode` and are a programming error.
pub fn encode(v: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    write(&mut out, v);
    out
}

fn write(out: &mut Vec<u8>, v: &Value) {
    match v {
        Value::Null => out.push(0xf6),
        Value::Bool(false) => out.push(0xf4),
        Value::Bool(true) => out.push(0xf5),
        Value::Int(n) => {
            assert!(
                n.unsigned_abs() <= MAX_SAFE_INTEGER as u64,
                "integer outside safe range"
            );
            if *n >= 0 {
                head(out, 0, *n as u64)
            } else {
                head(out, 1, (-1 - n) as u64)
            }
        }
        Value::Bytes(b) => {
            head(out, 2, b.len() as u64);
            out.extend_from_slice(b);
        }
        Value::Text(s) => {
            head(out, 3, s.len() as u64);
            out.extend_from_slice(s.as_bytes());
        }
        Value::Array(items) => {
            head(out, 4, items.len() as u64);
            for item in items {
                write(out, item);
            }
        }
        Value::Map(entries) => {
            let mut encoded: Vec<(Vec<u8>, &Value)> = entries
                .iter()
                .map(|(k, v)| (encode(&Value::Text(k.clone())), v))
                .collect();
            encoded.sort_by(|a, b| a.0.cmp(&b.0));
            head(out, 5, encoded.len() as u64);
            for (k, v) in encoded {
                out.extend_from_slice(&k);
                write(out, v);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], CborError> {
        if n > self.b.len() - self.i {
            return Err(CborError::Eof);
        }
        let s = &self.b[self.i..self.i + n];
        self.i += n;
        Ok(s)
    }

    fn remaining(&self) -> usize {
        self.b.len() - self.i
    }

    fn arg(&mut self, info: u8) -> Result<u64, CborError> {
        let (n, min) = match info {
            0..=23 => return Ok(info as u64),
            24 => (1, 24u64),
            25 => (2, 0x100),
            26 => (4, 0x1_0000),
            27 => (8, 0x1_0000_0000),
            _ => return Err(CborError::Unsupported),
        };
        let v = self
            .take(n)?
            .iter()
            .fold(0u64, |acc, &b| (acc << 8) | b as u64);
        if v < min {
            return Err(CborError::NonShortest);
        }
        if v > MAX_SAFE_INTEGER as u64 {
            return Err(CborError::OutOfRange);
        }
        Ok(v)
    }

    fn len(&mut self, info: u8) -> Result<usize, CborError> {
        let n = self.arg(info)?;
        if n > self.remaining() as u64 {
            return Err(CborError::Eof);
        }
        Ok(n as usize)
    }

    fn value(&mut self, depth: usize) -> Result<Value, CborError> {
        if depth > MAX_DEPTH {
            return Err(CborError::Depth);
        }
        let first = self.take(1)?[0];
        let (major, info) = (first >> 5, first & 0x1f);
        Ok(match major {
            0 => Value::Int(self.arg(info)? as i64),
            1 => {
                let n = self.arg(info)?;
                if n >= MAX_SAFE_INTEGER as u64 {
                    return Err(CborError::OutOfRange);
                }
                Value::Int(-1 - n as i64)
            }
            2 => {
                let n = self.len(info)?;
                Value::Bytes(self.take(n)?.to_vec())
            }
            3 => {
                let n = self.len(info)?;
                let s = std::str::from_utf8(self.take(n)?).map_err(|_| CborError::Utf8)?;
                Value::Text(s.to_owned())
            }
            4 => {
                let n = self.len(info)?;
                let mut items = Vec::with_capacity(n);
                for _ in 0..n {
                    items.push(self.value(depth + 1)?);
                }
                Value::Array(items)
            }
            5 => {
                let n = self.len(info)?;
                let mut entries = Vec::with_capacity(n);
                let mut prev: Option<&[u8]> = None;
                for _ in 0..n {
                    let start = self.i;
                    if self.b.get(self.i).map(|b| b >> 5) != Some(3) {
                        return Err(CborError::MapKeys);
                    }
                    let Value::Text(k) = self.value(depth + 1)? else {
                        unreachable!()
                    };
                    let key_bytes = &self.b[start..self.i];
                    if prev.is_some_and(|p| p >= key_bytes) {
                        return Err(CborError::MapKeys);
                    }
                    prev = Some(key_bytes);
                    entries.push((k, self.value(depth + 1)?));
                }
                Value::Map(entries)
            }
            7 => match info {
                20 => Value::Bool(false),
                21 => Value::Bool(true),
                22 => Value::Null,
                _ => return Err(CborError::Unsupported),
            },
            _ => return Err(CborError::Unsupported), // 6: tags
        })
    }
}

pub fn decode(b: &[u8]) -> Result<Value, CborError> {
    let mut r = Reader { b, i: 0 };
    let v = r.value(0)?;
    if r.i != b.len() {
        return Err(CborError::Trailing);
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_keys_by_encoded_form() {
        let v = Value::map([
            ("aa", Value::Int(3)),
            ("b", Value::Int(1)),
            ("a", Value::Int(2)),
        ]);
        assert_eq!(hex(&encode(&v)), "a3616102616201626161".to_owned() + "03");
    }

    #[test]
    fn round_trips_extremes() {
        for n in [0, 23, 24, MAX_SAFE_INTEGER, -1, -MAX_SAFE_INTEGER] {
            assert_eq!(decode(&encode(&Value::Int(n))).unwrap(), Value::Int(n));
        }
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
}
