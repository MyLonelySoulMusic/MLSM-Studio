use base64::{engine::general_purpose::STANDARD, Engine as _};
use regex::Regex;
use reqwest::{
    blocking::{Client, Response},
    header::{CONTENT_LENGTH, CONTENT_TYPE, LOCATION},
};
use std::{
    collections::HashSet,
    io::Read,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs},
    time::Duration,
};
use url::Url;

const MAX_HTML_BYTES: usize = 1024 * 1024;
const MAX_ICON_BYTES: usize = 512 * 1024;
const MAX_REDIRECTS: usize = 4;
const CHATGPT_FAVICON: &str = "https://cdn.oaistatic.com/assets/favicon-miwirzcw.ico";

fn public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_multicast()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

fn public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    if let Some(mapped) = address.to_ipv4_mapped() {
        return public_ipv4(mapped);
    }
    !(address.is_loopback()
        || address.is_unspecified()
        || address.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8))
}

fn validate_public_url(value: &Url) -> Result<(), String> {
    if !matches!(value.scheme(), "http" | "https")
        || !value.username().is_empty()
        || value.password().is_some()
    {
        return Err("Sono consentiti soltanto URL HTTP/HTTPS pubblici senza credenziali.".into());
    }
    let host = value
        .host_str()
        .ok_or_else(|| "Il link non contiene un dominio valido.".to_owned())?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return Err("Gli indirizzi locali non possono essere usati per recuperare favicon.".into());
    }
    let port = value
        .port_or_known_default()
        .ok_or_else(|| "Porta URL non valida.".to_owned())?;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "Il dominio non può essere risolto.".to_owned())?
        .collect::<Vec<_>>();
    if addresses.is_empty()
        || addresses.iter().any(|address| match address.ip() {
            IpAddr::V4(value) => !public_ipv4(value),
            IpAddr::V6(value) => !public_ipv6(value),
        })
    {
        return Err("Il dominio punta a un indirizzo locale o riservato.".into());
    }
    Ok(())
}

fn read_limited(mut response: Response, max_bytes: usize) -> Result<(Vec<u8>, String), String> {
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|size| size > max_bytes)
    {
        return Err("La risorsa supera il limite consentito.".into());
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > max_bytes {
        return Err("La risorsa supera il limite consentito.".into());
    }
    Ok((bytes, content_type))
}

fn get(client: &Client, initial: Url, max_bytes: usize) -> Result<(Url, Vec<u8>, String), String> {
    let mut current = initial;
    for _ in 0..=MAX_REDIRECTS {
        validate_public_url(&current)?;
        let response = client
            .get(current.clone())
            .send()
            .map_err(|error| error.to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Redirect privo di destinazione.".to_owned())?;
            current = current
                .join(location)
                .map_err(|_| "Redirect non valido.".to_owned())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }
        let (bytes, content_type) = read_limited(response, max_bytes)?;
        return Ok((current, bytes, content_type));
    }
    Err("Troppi redirect durante il recupero della favicon.".into())
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let expression = Regex::new(&format!(
        r#"(?is)\b{}\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))"#,
        regex::escape(name)
    ))
    .ok()?;
    let captures = expression.captures(tag)?;
    (1..=3)
        .find_map(|index| {
            captures
                .get(index)
                .map(|value| value.as_str().trim().to_owned())
        })
        .filter(|value| !value.is_empty())
}

fn icon_links(html: &str, page_url: &Url) -> Vec<Url> {
    let link = Regex::new(r"(?is)<link\b[^>]*>").expect("valid link expression");
    link.find_iter(html)
        .filter_map(|value| {
            let tag = value.as_str();
            let rel = attribute(tag, "rel")?.to_ascii_lowercase();
            if !rel
                .split_whitespace()
                .any(|token| token == "icon" || token == "shortcut")
            {
                return None;
            }
            page_url.join(&attribute(tag, "href")?).ok()
        })
        .collect()
}

fn known_icon_links(page_url: &Url) -> Vec<Url> {
    let hostname = page_url.host_str().unwrap_or_default().to_ascii_lowercase();
    if hostname == "chatgpt.com"
        || hostname.ends_with(".chatgpt.com")
        || hostname == "chat.openai.com"
    {
        Url::parse(CHATGPT_FAVICON).into_iter().collect()
    } else {
        Vec::new()
    }
}

fn detected_image_mime(declared: &str, bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"\x00\x00\x01\x00") {
        return Some("image/x-icon");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(256)])
        .trim_start()
        .to_ascii_lowercase();
    if prefix.starts_with("<svg") || prefix.starts_with("<?xml") && prefix.contains("<svg") {
        return Some("image/svg+xml");
    }
    match declared {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("image/x-icon"),
        "image/svg+xml" => Some("image/svg+xml"),
        _ => None,
    }
}

fn fetch_favicon(page: &str) -> Result<Option<String>, String> {
    let page_url = Url::parse(page).map_err(|_| "Link non valido.".to_owned())?;
    validate_public_url(&page_url)?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .user_agent("MLSM-Studio/0.1 favicon")
        .build()
        .map_err(|error| error.to_string())?;
    let mut seen = HashSet::new();
    for candidate in known_icon_links(&page_url) {
        seen.insert(candidate.as_str().to_owned());
        if let Ok((_, bytes, declared)) = get(&client, candidate, MAX_ICON_BYTES) {
            if let Some(mime) = detected_image_mime(&declared, &bytes) {
                return Ok(Some(format!(
                    "data:{mime};base64,{}",
                    STANDARD.encode(bytes)
                )));
            }
        }
    }
    let mut resolved_page = page_url.clone();
    let mut candidates = Vec::new();
    if let Ok((page, html_bytes, page_type)) = get(&client, page_url.clone(), MAX_HTML_BYTES) {
        if let Some(mime) = detected_image_mime(&page_type, &html_bytes) {
            return Ok(Some(format!(
                "data:{mime};base64,{}",
                STANDARD.encode(html_bytes)
            )));
        }
        resolved_page = page;
        candidates.extend(icon_links(
            &String::from_utf8_lossy(&html_bytes),
            &resolved_page,
        ));
    }
    if let Ok(value) = resolved_page.join("/favicon.ico") {
        candidates.push(value);
    }
    if let Ok(value) = resolved_page.join("/apple-touch-icon.png") {
        candidates.push(value);
    }
    if let Ok(value) = resolved_page.join("/favicon.png") {
        candidates.push(value);
    }
    for candidate in candidates {
        if !seen.insert(candidate.as_str().to_owned()) {
            continue;
        }
        if let Ok((_, bytes, declared)) = get(&client, candidate, MAX_ICON_BYTES) {
            if let Some(mime) = detected_image_mime(&declared, &bytes) {
                return Ok(Some(format!(
                    "data:{mime};base64,{}",
                    STANDARD.encode(bytes)
                )));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn fetch_postit_favicon(url: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_favicon(&url))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_declared_icon_links() {
        let page = Url::parse("https://example.com/path/page").unwrap();
        let result = icon_links(
            r#"<link rel="stylesheet" href="x.css"><link sizes="32x32" rel="shortcut icon" href="/assets/icon.png">"#,
            &page,
        );
        assert_eq!(result[0].as_str(), "https://example.com/assets/icon.png");
    }

    #[test]
    fn blocks_local_and_private_targets() {
        assert!(validate_public_url(&Url::parse("http://127.0.0.1/icon.png").unwrap()).is_err());
        assert!(validate_public_url(&Url::parse("http://localhost/icon.png").unwrap()).is_err());
    }

    #[test]
    fn uses_official_static_favicon_for_chatgpt_links() {
        let candidates = known_icon_links(
            &Url::parse("https://chatgpt.com/share/00000000-0000-0000-0000-000000000000").unwrap(),
        );
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].as_str(), CHATGPT_FAVICON);
        assert!(known_icon_links(&Url::parse("https://example.com").unwrap()).is_empty());
    }
}
