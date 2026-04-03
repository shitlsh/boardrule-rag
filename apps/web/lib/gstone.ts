import { load } from "cheerio";

/**
 * Parse Gstone (集石) game page HTML and return ordered rule image URLs (same logic as dify-boardgame-rule-agent).
 */
export async function fetchGstoneRuleImageUrls(pageUrl: string): Promise<string[]> {
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`规则页面请求失败：${res.status}`);
  }

  const html = await res.text();
  const $ = load(html);
  const container =
    $("#preview_imgs").length > 0 ? $("#preview_imgs") : $(".article-all .describe").first();
  if (container.length === 0) {
    throw new Error("未找到规则图片容器（#preview_imgs 或 .article-all .describe）");
  }

  const links = new Set<string>();
  container.find("img").each((_idx, el) => {
    const src = ($(el).attr("data-original") || $(el).attr("src") || "").trim();
    if (!src) return;
    if (src.startsWith("//")) {
      links.add(`https:${src}`);
      return;
    }
    links.add(new URL(src, pageUrl).toString());
  });
  if (links.size === 0) {
    throw new Error("未提取到规则图片链接");
  }
  return Array.from(links);
}

export type DownloadedImage = { name: string; buffer: Buffer };

/** Download rule images for rule_engine multipart (ordered). */
export async function downloadRuleImagesFromUrls(
  imageUrls: string[],
  refererUrl: string,
  opts?: { maxBytesPerImage: number },
): Promise<DownloadedImage[]> {
  const maxB = opts?.maxBytesPerImage;
  const results: DownloadedImage[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const link = imageUrls[i];
    const imgRes = await fetch(link, {
      headers: { Referer: refererUrl, "User-Agent": "Mozilla/5.0" },
    });
    if (!imgRes.ok) {
      throw new Error(`下载规则图片失败：${imgRes.status} ${link}`);
    }
    const arr = Buffer.from(await imgRes.arrayBuffer());
    if (maxB !== undefined && arr.length > maxB) {
      throw new Error(
        `第 ${i + 1} 张规则图超过单张上限 ${maxB} 字节（约 ${(maxB / (1024 * 1024)).toFixed(1)} MiB）`,
      );
    }
    results.push({ name: `${String(i + 1).padStart(3, "0")}_page`, buffer: arr });
  }
  return results;
}
