import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

// Manifest JSON là hợp đồng giữa bước trích xuất (script extract-handbook, hoặc soạn tay) và bước
// nạp vào Mongo. Người soát (P.HCNS) xem/sửa file này trước khi nạp.

export interface ManifestArticle {
  articleIdx: number;
  title: string;
  // Nhãn hiển thị ở chip trích dẫn. Mặc định `${shortName} – Điều ${articleIdx}`.
  label: string;
  chapter: string;
  blocks: string[];
}

export interface ManifestDocument {
  // Mã văn bản, vd "NOI_QUY". Sẽ nằm trong URL/citation nên chỉ cho phép A-Z, 0-9, "_".
  documentCode: string;
  documentTitle: string;
  shortName: string;
  sourceFileName: string | null;
  sourceSha256: string | null;
  articles: ManifestArticle[];
}

export interface HandbookManifest {
  documents: ManifestDocument[];
  suggestions: string[];
  note: string | null;
}

export const DOCUMENT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
const MAX_SUGGESTIONS = 12;
const MAX_SUGGESTION_LENGTH = 200;

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clean = (value: string): string => value.normalize("NFC").trim();

export function defaultArticleLabel(shortName: string, articleIdx: number): string {
  return `${shortName} – Điều ${articleIdx}`;
}

function readString(
  source: Raw,
  key: string,
  where: string,
  problems: string[],
  options: { required?: boolean; max?: number } = {}
): string {
  const { required = true, max = 300 } = options;
  const value = source[key];
  if (value === undefined || value === null || value === "") {
    if (required) problems.push(`${where}: thiếu "${key}"`);
    return "";
  }
  if (typeof value !== "string") {
    problems.push(`${where}: "${key}" phải là chuỗi`);
    return "";
  }
  const text = clean(value);
  if (required && !text) problems.push(`${where}: "${key}" rỗng`);
  if (text.length > max) problems.push(`${where}: "${key}" dài quá ${max} ký tự`);
  return text;
}

function parseArticle(
  raw: unknown,
  shortName: string,
  where: string,
  problems: string[]
): ManifestArticle | null {
  if (!isObject(raw)) {
    problems.push(`${where}: phải là object`);
    return null;
  }
  const { articleIdx } = raw;
  if (!Number.isInteger(articleIdx) || (articleIdx as number) < 0) {
    problems.push(`${where}: "articleIdx" phải là số nguyên không âm`);
    return null;
  }
  const idx = articleIdx as number;
  const label = readString(raw, "label", where, problems, { required: false, max: 200 });
  const title = readString(raw, "title", where, problems);
  const chapter = readString(raw, "chapter", where, problems, { required: false });

  let blocks: string[] = [];
  if (!Array.isArray(raw.blocks) || !raw.blocks.length) {
    problems.push(`${where}: "blocks" phải là mảng có ít nhất 1 đoạn`);
  } else {
    blocks = raw.blocks.map((block) => (typeof block === "string" ? clean(block) : ""));
    if (blocks.some((block) => !block))
      problems.push(`${where}: "blocks" có đoạn rỗng/không phải chuỗi`);
  }

  return {
    articleIdx: idx,
    title,
    label: label || defaultArticleLabel(shortName, idx),
    chapter,
    blocks
  };
}

function parseDocument(
  raw: unknown,
  where: string,
  problems: string[],
  seenCodes: Set<string>
): ManifestDocument | null {
  if (!isObject(raw)) {
    problems.push(`${where}: phải là object`);
    return null;
  }
  const documentCode = readString(raw, "documentCode", where, problems, { max: 40 });
  if (documentCode && !DOCUMENT_CODE_PATTERN.test(documentCode)) {
    problems.push(
      `${where}: documentCode "${documentCode}" chỉ gồm A-Z, 0-9, "_" và bắt đầu bằng chữ`
    );
  }
  if (documentCode) {
    if (seenCodes.has(documentCode))
      problems.push(`${where}: trùng documentCode "${documentCode}"`);
    seenCodes.add(documentCode);
  }
  const label = documentCode || where;
  const documentTitle = readString(raw, "documentTitle", label, problems, { max: 200 });
  const shortName = readString(raw, "shortName", label, problems, { max: 60 });
  const sourceFileName = readString(raw, "sourceFileName", label, problems, { required: false });
  const sourceSha256 = readString(raw, "sourceSha256", label, problems, {
    required: false,
    max: 64
  });

  const articles: ManifestArticle[] = [];
  if (!Array.isArray(raw.articles) || !raw.articles.length) {
    problems.push(`${label}: "articles" phải là mảng có ít nhất 1 mục`);
  } else {
    const seenIdx = new Set<number>();
    raw.articles.forEach((rawArticle, index) => {
      const article = parseArticle(rawArticle, shortName, `${label}.articles[${index}]`, problems);
      if (!article) return;
      if (seenIdx.has(article.articleIdx)) {
        problems.push(`${label}: trùng articleIdx ${article.articleIdx}`);
        return;
      }
      seenIdx.add(article.articleIdx);
      articles.push(article);
    });
  }
  articles.sort((a, b) => a.articleIdx - b.articleIdx);

  return {
    documentCode,
    documentTitle,
    shortName,
    sourceFileName: sourceFileName || null,
    sourceSha256: sourceSha256 || null,
    articles
  };
}

// Kiểm tra + chuẩn hoá manifest; gom MỌI vấn đề vào một lần báo để người soát sửa một lượt.
export function parseManifest(input: unknown): HandbookManifest {
  const problems: string[] = [];
  if (!isObject(input)) {
    throw new ArgumentInvalidException("Manifest phải là object JSON");
  }

  const documents: ManifestDocument[] = [];
  if (!Array.isArray(input.documents) || !input.documents.length) {
    problems.push(`"documents" phải là mảng có ít nhất 1 văn bản`);
  } else {
    const seenCodes = new Set<string>();
    input.documents.forEach((rawDoc, index) => {
      const doc = parseDocument(rawDoc, `documents[${index}]`, problems, seenCodes);
      if (doc) documents.push(doc);
    });
  }

  let suggestions: string[] = [];
  if (input.suggestions !== undefined) {
    if (!Array.isArray(input.suggestions)) {
      problems.push(`"suggestions" phải là mảng chuỗi`);
    } else {
      suggestions = input.suggestions.map((s) => (typeof s === "string" ? clean(s) : ""));
      if (suggestions.some((s) => !s || s.length > MAX_SUGGESTION_LENGTH)) {
        problems.push(`"suggestions" có câu rỗng hoặc dài quá ${MAX_SUGGESTION_LENGTH} ký tự`);
      }
      if (suggestions.length > MAX_SUGGESTIONS) {
        problems.push(`"suggestions" tối đa ${MAX_SUGGESTIONS} câu`);
      }
    }
  }

  const note = typeof input.note === "string" && clean(input.note) ? clean(input.note) : null;

  if (problems.length) {
    throw new ArgumentInvalidException(`Manifest không hợp lệ:\n- ${problems.join("\n- ")}`, {
      metadata: { problems }
    });
  }
  return { documents, suggestions, note };
}
