const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";

const HTML_ACCEPT = "text/html,application/xhtml+xml";

export async function fetchText(url: string): Promise<string> {
  const tryOnce = async (ua: string) => {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: HTML_ACCEPT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    return res;
  };

  let res = await tryOnce(DESKTOP_UA);
  if (res.status === 403) {
    res = await tryOnce(MOBILE_UA);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}
