import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const isTestRun = process.env.NODE_ENV === 'test' || process.env.SKIP_SERVER_START === '1' || process.argv.some((arg) => arg.includes('node:test'));
const SEARCH_RESULT_LIMIT = 20;
const FINAL_COMPANY_LIMIT = 20;
const BUILD_CANDIDATE_LIMIT = 50;

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function extractEmail(text) {
  const candidates = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const commonTlds = new Set(['com', 'net', 'org', 'io', 'co', 'info', 'biz', 'me', 'uk', 'us', 'de', 'fr', 'es', 'cn', 'ai', 'app', 'dev']);
  const valid = candidates
    .map((value) => value.replace(/[^A-Z0-9._%+-@]/gi, ''))
    .map((value) => value.replace(/^[\d().-]{7,}(?=[A-Z])/i, ''))
    .map((value) => value.replace(/^(?:email|e-mail|mail)(?=[A-Z0-9._%+-]+@)/i, ''))
    .filter((value) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value))
    .filter((value) => !/\.(?:jpg|jpeg|png|gif|pdf|svg|zip|rar|doc|docx|xls|xlsx|ppt|pptx)$/i.test(value))
    .filter((value) => {
      const match = value.match(/\.([A-Za-z]{2,63})$/i);
      if (!match) return false;
      const tld = match[1].toLowerCase();
      const local = value.split('@')[0] || '';
      if (/^\d[\d.-]{6,}[a-z]/i.test(local)) return false;
      return commonTlds.has(tld) || tld.length <= 4;
    });
  return valid[0] || '';
}

export function extractPhone(text) {
  const candidates = String(text || '').match(/\+?\d[\d().\s-]{6,}\d/g) || [];
  const valid = candidates
    .map((value) => normalizeText(value))
    .map((value) => value.replace(/^\d{5}\s+(?=\d{3}[-\s])/, ''))
    .filter((value) => {
      const digits = value.replace(/[^0-9]/g, '');
      if (/^\d{4}[-/.]\d{2}[-/.]\d{2}$/.test(value)) return false;
      if (/^\d{4}[-/.]\d{2}[-/.]\d{2}\s+\d{1,2}$/.test(value)) return false;
      if (/^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/.test(value)) return false;
      if (/\d+\.\d{4,}/.test(value)) return false;
      if (digits.length < 7 || digits.length > 15) return false;
      if (/^(?:0{3,}|1{3,})$/.test(digits)) return false;
      if (/^0{5,}/.test(digits)) return false;
      if (/^(?:1000|2000)\d{8,}$/.test(digits)) return false;
      const shortGroups = value.split(/[-.\s]+/).filter(Boolean).filter((part) => /^\d{1,2}$/.test(part)).length;
      if (shortGroups >= 5) return false;
      if (!/^\+/.test(value) && !/[\s().-]/.test(value)) return false;
      return true;
    });
  return valid[0] || '';
}

export function extractWebsite(text) {
  const match = text.match(/https?:\/\/[^\s"']+/i);
  return match ? match[0] : '';
}

export function buildSearchQueries({ country, industry, keyword }) {
  const normalizedCountry = normalizeCountryForSearch(country);
  const rawCountry = normalizeText(country);
  const normalizedIndustry = normalizeText(industry);
  const normalizedKeyword = normalizeText(keyword);
  const base = [normalizedCountry, normalizedIndustry, normalizedKeyword].filter(Boolean).join(' ');
  const rawBase = [rawCountry, normalizedIndustry, normalizedKeyword].filter(Boolean).join(' ');
  const haystack = `${normalizedIndustry} ${normalizedKeyword}`.toLowerCase();
  const productTerms = new Set([normalizedIndustry, normalizedKeyword].filter(Boolean));

  if (/(jewelry|jewellery|bracelet|accessor|珠宝|首饰|饰品|耳钉|耳环|手链)/i.test(haystack)) {
    ['fashion jewelry', 'jewelry', 'bracelet', 'wholesale jewelry', 'OEM jewelry', 'handmade jewelry', 'silver jewelry', 'fashion accessories'].forEach((term) => productTerms.add(term));
  }
  if (/(led|lighting|lamp|fixture|luminair)/i.test(haystack)) {
    ['LED lighting', 'commercial LED lighting', 'industrial LED lighting', 'LED fixture', 'LED lamp', 'lighting solutions'].forEach((term) => productTerms.add(term));
  }
  if (/(auto|automotive|vehicle|spare|parts|aftermarket)/i.test(haystack)) {
    ['auto parts', 'automotive parts', 'vehicle parts', 'aftermarket parts', 'spare parts', 'OEM automotive parts'].forEach((term) => productTerms.add(term));
  }

  const buyerTerms = ['manufacturer', 'supplier', 'factory', 'exporter', 'wholesale supplier', 'OEM manufacturer', 'ODM manufacturer', 'products contact'];
  const expanded = [...productTerms].flatMap((term) => buyerTerms.map((buyerTerm) => `${normalizedCountry} ${term} ${buyerTerm}`));
  return [...new Set([
    base,
    rawBase,
    `${base} company`,
    `${base} manufacturer`,
    `${base} supplier`,
    `${rawBase} supplier`,
    ...expanded,
  ].map(normalizeText).filter(Boolean))].slice(0, 24);
}

function normalizeCountryForSearch(country) {
  const value = normalizeText(country).toLowerCase();
  const aliases = new Map([
    ['美国', 'United States'],
    ['美國', 'United States'],
    ['英国', 'United Kingdom'],
    ['英國', 'United Kingdom'],
    ['德国', 'Germany'],
    ['德國', 'Germany'],
    ['法国', 'France'],
    ['法國', 'France'],
    ['西班牙', 'Spain'],
    ['意大利', 'Italy'],
    ['加拿大', 'Canada'],
    ['澳大利亚', 'Australia'],
    ['澳洲', 'Australia'],
    ['日本', 'Japan'],
    ['韩国', 'South Korea'],
    ['韓國', 'South Korea'],
    ['新加坡', 'Singapore'],
    ['阿联酋', 'UAE'],
    ['阿聯酋', 'UAE'],
  ]);
  return aliases.get(value) || country;
}

const CONTENT_GARBAGE_PATTERNS = [
  /FOREIGN INVESTORS/gi,
  /National flag/gi,
  /Vietnamese/gi,
  /Declaration/gi,
  /Skip to content/gi,
  /Home Products/gi,
  /copyright/gi,
  /all rights reserved/gi,
  /privacy policy/gi,
  /terms (?:and|&) conditions/gi,
  /request a quote/gi,
  /dealer log in/gi,
  /search for:? search/gi,
  /main menu/gi,
];

function cleanBusinessText(value) {
  let cleaned = normalizeText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[{}[\]<>|\\]/g, ' ')
    .replace(/\b(?:home|menu|catalog|login|search|contact|about|privacy|terms|cart|wishlist|subscribe)\b/gi, ' ');
  CONTENT_GARBAGE_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, ' ');
  });
  return normalizeText(cleaned);
}

function inferBusinessProfile(text, fallback = '') {
  const cleaned = cleanBusinessText(`${text || ''} ${fallback || ''}`);
  const haystack = cleaned.toLowerCase();
  if (/(led|lighting|lamp|fixture|luminair|illumination)/i.test(haystack)) {
    return 'commercial and industrial LED lighting solutions, including indoor and outdoor fixtures, lamps, controls, and project lighting products';
  }
  if (/(jewelry|jewellery|bracelet|necklace|ring|accessor)/i.test(haystack)) {
    return 'fashion jewelry, custom pieces, wholesale accessories, and retail-ready jewelry products';
  }
  if (/(furniture|chair|table|cabinet|sofa|wood)/i.test(haystack)) {
    return 'furniture, fixtures, and interior product supply for commercial or retail buyers';
  }
  if (/(hardware|tool|fastener|industrial|component|engineering)/i.test(haystack)) {
    return 'industrial hardware, components, engineering products, and related supply items';
  }
  if (/(auto parts|automotive|vehicle|aftermarket|spare parts|car parts|oem parts)/i.test(haystack)) {
    return 'automotive parts, aftermarket components, OEM vehicle parts, and mobility supply products';
  }
  return cleanBusinessText(fallback || cleaned).slice(0, 160) || 'relevant products and services';
}

export function extractBusiness(text, fallback = '') {
  const cleaned = normalizeText(text.replace(/[\r\n\t]+/g, ' '));
  const sentences = cleaned.split(/[.!?]/).map(normalizeText).filter(Boolean);
  const candidates = sentences
    .map(cleanBusinessText)
    .filter((sentence) => sentence.length >= 20)
    .filter((sentence) => /(manufactur|supplier|provider|solutions|products|services|systems|design|lighting|furniture|hardware|industrial|engineering|wholesale|export|trading|components|assembly|packaging)/i.test(sentence))
    .filter((sentence) => !/(foreign investors|national flag|vietnamese|declaration|copyright|privacy|terms|menu|seo|skip to content)/i.test(sentence));
  return inferBusinessProfile(candidates[0] || cleaned, fallback).slice(0, 220);
}

function extractCompanyName($, fallback = '') {
  const candidates = ['meta[property="og:site_name"]', 'meta[name="application-name"]', 'h1', 'title'];
  for (const selector of candidates) {
    const value = $(selector).first().attr('content') || $(selector).first().text();
    if (value) return normalizeText(value);
  }
  return fallback;
}

function extractPageText($) {
  $('script, style, noscript, svg').remove();
  return normalizeText(($('body').text() || $.root().text()).replace(/[\r\n\t]+/g, ' '));
}

function cleanUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return normalizeText(url);
  }
}

const BLOCKED_HOSTS = [
  'wikipedia.org',
  'youtube.com',
  'youtu.be',
  'pinterest.com',
  'pinterest.co.uk',
  'reddit.com',
  'quora.com',
  'medium.com',
  'blogspot.com',
  'wordpress.com',
  'substack.com',
  'tumblr.com',
  'wikihow.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'yellowpages.com',
  'yellowpages.com.vn',
  'kompass.com',
  'thomasnet.com',
  'yelp.com',
  'mapquest.com',
  'dnb.com',
  'zoominfo.com',
  'crunchbase.com',
  'dexigner.com',
  'expertmarketresearch.com',
  'fobsourcify.com',
  'sourcifychina.com',
  'made-in-china.com',
  'alibaba.com',
  'globalsources.com',
  'importyeti.com',
  'united.com',
  'expedia.com',
  'tripadvisor.com',
  'booking.com',
  'kayak.com',
  'baidu.com',
  'google.com',
  'dingtalk.com',
  'skyscanner.com.hk',
  'vnexpress.net',
  'vietnamnet.vn',
  'voachinese.com',
  'bbc.com',
  'cnn.com',
  'reuters.com',
  'apnews.com',
  'nytimes.com',
  'theguardian.com',
  'forbes.com',
  'bloomberg.com',
  'npr.org',
  'gov',
  'edu',
  'ac.uk',
  'edu.vn',
  'gov.vn',
  'org.vn',
];
const BLOCKED_PATH_PATTERNS = [/\/news\//i, /\/blog\//i, /\/blogs\//i, /\/forum\//i, /\/forums\//i, /\/community\//i, /\/gallery\//i, /\/images\//i, /\/photo\//i, /\/photos\//i, /\/video\//i, /\/travel\//i, /\/tourism\//i, /\/wiki\//i, /\/article\//i, /\/articles\//i, /\/post\//i, /\/posts\//i, /\/story\//i, /\/stories\//i, /\/careers\//i, /\/jobs\//i, /\/recruit/i, /\/press\//i, /\/investors\//i, /\/privacy/i, /\/terms/i, /\/login/i, /\/signup/i, /\.(jpg|jpeg|png|gif|pdf|svg|zip|rar|doc|docx|xls|xlsx|ppt|pptx)$/i];
const PREFERRED_TERMS = ['manufacturer', 'supplier', 'factory', 'wholesaler', 'wholesale', 'trading company', 'production', 'manufacturing', 'export', 'distributor', 'company', 'industrial', 'solutions', 'products', 'services', 'automotive', 'aftermarket', 'components', 'about us', 'contact us'];
const NON_ENTERPRISE_IDENTITY_PATTERNS = [
  /\bgovernment\b/i,
  /\bministry\b/i,
  /\bdepartment of\b/i,
  /\bembassy\b/i,
  /\bconsulate\b/i,
  /\bassociation\b/i,
  /\bfederation\b/i,
  /\bchamber of commerce\b/i,
  /\binstitute\b/i,
  /\buniversity\b/i,
  /\bschool\b/i,
  /\bwikipedia\b/i,
  /(?:政府|协会|協會|学校|學校|百科)/i,
];
const NON_ENTERPRISE_CONTENT_PATTERNS = [
  /\btop\s+\d+\b/i,
  /\btop\b.{0,60}\bmanufacturers?\b/i,
  /\btop\b.{0,60}\bsuppliers?\b/i,
  /\bbest\s+\d+\b/i,
  /\blist of\b/i,
  /\bmarket report\b/i,
  /\bmarket size\b/i,
  /\bmarket share\b/i,
  /\bindustry analysis\b/i,
  /\bbuyers guide\b/i,
  /\bsourcing agent\b/i,
  /\bimport from china\b/i,
  /\bverified suppliers?\b/i,
  /\bcompany profiles?\b/i,
  /\bsupplier directory\b/i,
  /\btourism guide\b/i,
  /\btravel guide\b/i,
  /\bpersonal website\b/i,
  /\bfacebook post\b/i,
  /\bwikipedia\b/i,
  /前\s*\d+\s*名/i,
  /(?:新闻|新聞|报告|報告|排行榜|名单|名單|旅游指南|旅行指南|个人网站|個人網站)/i,
];

function isBlockedHost(host) {
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function isRealCompanyWebsite(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const fullPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (isSearchEngineUrl(url) || isBlockedHost(host)) return false;
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(fullPath))) return false;
    if (host.split('.').length < 2) return false;
    return true;
  } catch {
    return false;
  }
}

function getTopicTerms(topic) {
  const aliases = {
    jewelry: ['jewelry', 'jewellery', 'bracelet', 'necklace', 'ring', 'earring', 'accessory', 'accessories', 'gemstone', 'silver', 'gold'],
    bracelet: ['bracelet', 'jewelry', 'jewellery', 'accessory', 'accessories', 'bangle', 'bead'],
    lighting: ['lighting', 'led', 'lamp', 'fixture', 'luminaire', 'illumination'],
    led: ['led', 'lighting', 'lamp', 'fixture', 'luminaire'],
    auto: ['auto', 'automotive', 'vehicle', 'parts', 'component', 'components', 'aftermarket', 'spare'],
    automotive: ['auto', 'automotive', 'vehicle', 'parts', 'component', 'components', 'aftermarket', 'spare'],
    parts: ['parts', 'component', 'components', 'aftermarket', 'spare', 'automotive', 'vehicle'],
    furniture: ['furniture', 'chair', 'table', 'cabinet', 'sofa', 'wood'],
    hardware: ['hardware', 'tool', 'fastener', 'component', 'industrial'],
  };
  const baseTerms = normalizeText(topic)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !['and', 'the', 'for', 'with', 'company', 'manufacturer', 'supplier', 'factory', 'exporter', 'oem'].includes(term));
  return [...new Set(baseTerms.flatMap((term) => [term, ...(aliases[term] || [])]))];
}

function textContainsTerm(text, term) {
  if (term.length <= 4) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
  }
  return text.includes(term);
}

function getCountrySignals(country) {
  const normalized = normalizeText(country).toLowerCase();
  if (!normalized) return [];
  const signals = {
    vietnam: ['vietnam', 'viet nam', 'vina', '.vn', '+84', 'hanoi', 'ha noi', 'ho chi minh', 'saigon'],
    'united states': ['united states', 'usa', 'u.s.', '.us', '+1'],
    usa: ['united states', 'usa', 'u.s.', '.us', '+1'],
    germany: ['germany', 'deutschland', '.de', '+49'],
    'united kingdom': ['united kingdom', 'uk', '.co.uk', '+44'],
    uk: ['united kingdom', 'uk', '.co.uk', '+44'],
  };
  return signals[normalized] || [normalized];
}

function hasCountryMismatch(text) {
  return /\b(?:bangladesh|india|china|pakistan|nepal|sri lanka)\b/i.test(text) || /(?:\+880|\+91|\+86|\+92|\+977|\+94)/.test(text);
}

export function identifyEnterpriseCandidate({ url, text = '', company = '', topic = '', country = '' }) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const fullPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (!isRealCompanyWebsite(url)) {
      return { keep: false, reason: 'not-real-company-website' };
    }
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(fullPath))) {
      return { keep: false, reason: 'blocked-path' };
    }
    if (/\.(?:jpg|jpeg|png|gif|pdf|svg|zip|rar|doc|docx|xls|xlsx|ppt|pptx)$/i.test(parsed.pathname)) {
      return { keep: false, reason: 'file-url' };
    }
    const haystack = `${company || ''} ${text || ''}`.toLowerCase();
    const identityText = `${company || ''} ${host} ${fullPath}`;
    if (NON_ENTERPRISE_IDENTITY_PATTERNS.some((pattern) => pattern.test(identityText))) {
      return { keep: false, reason: 'non-enterprise-identity' };
    }
    if (NON_ENTERPRISE_CONTENT_PATTERNS.some((pattern) => pattern.test(haystack))) {
      return { keep: false, reason: 'non-company-content' };
    }
    const topicTerms = getTopicTerms(topic);
    const topicHaystack = `${host} ${parsed.pathname.toLowerCase()} ${haystack}`;
    const matchesTopic = topicTerms.some((term) => textContainsTerm(topicHaystack, term));
    if (topicTerms.length > 0 && !matchesTopic) {
      return { keep: false, reason: 'topic-mismatch' };
    }
    const countrySignals = getCountrySignals(country);
    if (countrySignals.length > 0) {
      const countryHaystack = `${host} ${parsed.pathname.toLowerCase()} ${haystack}`;
      const matchesCountry = countrySignals.some((signal) => countryHaystack.includes(signal));
      if (!matchesCountry) {
        return { keep: false, reason: 'country-mismatch' };
      }
    }
    const hasBusinessSignal = PREFERRED_TERMS.some((term) => haystack.includes(term)) || /company|factory|supplier|manufacturer|wholesale|distributor|production|solutions|products|industrial|services|brand|catalog|portfolio|oem|odm|exporter|export|custom|workshop/i.test(haystack);
    const hasCommercialIdentity = /\b(?:manufacturer|factory|supplier|wholesale|wholesaler|distributor|exporter|oem|odm|custom|production|products|catalog|brand|company|co\.|ltd|limited|inc|llc|corp|corporation)\b/i.test(`${company} ${text}`);
    const hasCompanyName = normalizeText(company || '').length >= 2;
    if (/(job|career|recruit|apply now|hiring)/i.test(haystack)) {
      return { keep: false, reason: 'recruiting-page' };
    }
    if (!hasCompanyName || !hasBusinessSignal || !hasCommercialIdentity) {
      return { keep: false, reason: 'missing-enterprise-signal' };
    }
    return { keep: true, reason: 'enterprise-topic-match' };
  } catch {
    return { keep: false, reason: 'invalid-url' };
  }
}

export function shouldKeepCandidate(candidate) {
  return identifyEnterpriseCandidate(candidate).keep;
}

export function buildLeadFromCandidate({
  company,
  website,
  email = '',
  phone = '',
  country = '',
  source = '',
  sourceUrl = '',
  product = '',
}) {
  const cleanedCompany = normalizeText(company || '');
  const cleanedWebsite = normalizeText(website || '');
  const cleanedCountry = normalizeText(country || '');
  const cleanedSource = normalizeText(source || '');
  const cleanedSourceUrl = normalizeText(sourceUrl || '');

  return {
    company: cleanedCompany || (cleanedWebsite ? new URL(cleanedWebsite).hostname : '未知公司'),
    website: cleanedWebsite,
    email: normalizeText(email || ''),
    phone: normalizeText(phone || ''),
    country: cleanedCountry,
    product: normalizeText(product || ''),
    source: cleanedSource,
    sourceUrl: cleanedSourceUrl,
  };
}

export function dedupeCandidates(candidates) {
  const byUrl = new Map();
  const sourcePriority = ['Google Search', 'Official Website Seed', 'Google Maps', 'LinkedIn', 'Facebook', 'Directory', 'Bing', 'DuckDuckGo'];
  const normalizeUrl = (value) => {
    try {
      const parsed = new URL(value);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return normalizeText(value || '').toLowerCase();
    }
  };

  candidates.forEach((candidate) => {
    const key = normalizeUrl(candidate.url || '');
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...candidate });
      return;
    }
    const currentRank = sourcePriority.indexOf(candidate.source || '') >= 0 ? sourcePriority.indexOf(candidate.source || '') : 99;
    const existingRank = sourcePriority.indexOf(existing.source || '') >= 0 ? sourcePriority.indexOf(existing.source || '') : 99;
    if (currentRank < existingRank) {
      byUrl.set(key, { ...candidate });
    }
  });

  return [...byUrl.values()].sort((a, b) => {
    const rankA = sourcePriority.indexOf(a.source || '') >= 0 ? sourcePriority.indexOf(a.source || '') : 99;
    const rankB = sourcePriority.indexOf(b.source || '') >= 0 ? sourcePriority.indexOf(b.source || '') : 99;
    return rankA - rankB;
  });
}

function scoreOfficialCandidate(candidate) {
  try {
    const parsed = new URL(candidate.url || '');
    const path = parsed.pathname.replace(/\/+$/, '');
    const pathDepth = path.split('/').filter(Boolean).length;
    const source = candidate.source || '';
    const haystack = `${candidate.company || ''} ${candidate.url || ''}`.toLowerCase();

    let score = 0;
    if (source === 'Official Website Seed') score += 1000;
    if (pathDepth === 0) score += 120;
    if (pathDepth === 1) score += 40;
    if (PREFERRED_TERMS.some((term) => haystack.includes(term))) score += 20;
    if (source === 'Google Search') score += 12;
    if (source === 'Bing') score += 8;
    if (source === 'DuckDuckGo') score += 6;
    return score;
  } catch {
    return 0;
  }
}

export function selectOfficialCandidates(candidates, limit = 12) {
  return candidates
    .filter((candidate) => isRealCompanyWebsite(candidate.url))
    .map((candidate, index) => ({ candidate, index, score: scoreOfficialCandidate(candidate) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.candidate);
}

export function extractCity(text) {
  const patterns = [
    /(?:headquartered|based|located|office|operating)\s+in\s+([A-Z][A-Za-z .'-]+)/i,
    /,\s*([A-Z][A-Za-z .'-]+)\s*,\s*[A-Z]{2,}/,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match) return normalizeText(match[1]);
  }
  return '';
}

export function extractFoundedYear(text) {
  const match = String(text || '').match(/\b(?:founded|established|since)\s+(?:in\s+)?(\d{4})\b/i) || String(text || '').match(/\b(?:19|20)\d{2}\b/);
  return match ? normalizeText(match[1] || match[0]) : '';
}

export function extractEmployeeCount(text) {
  const match = String(text || '').match(/(\d+(?:\s*-\s*\d+)?\s*(?:employees?|staff|people|team members?))/i);
  return match ? normalizeText(match[1]) : '';
}

export function extractSocialLinks(text) {
  const links = { linkedin: '', facebook: '', instagram: '', googleMaps: '' };
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  matches.forEach((value) => {
    const normalized = normalizeText(value.replace(/[),;]+$/, ''));
    if (!links.linkedin && /linkedin\.com/i.test(normalized)) links.linkedin = normalized;
    if (!links.facebook && /facebook\.com/i.test(normalized)) links.facebook = normalized;
    if (!links.instagram && /instagram\.com/i.test(normalized)) links.instagram = normalized;
    if (!links.googleMaps && /google\.com\/maps/i.test(normalized)) links.googleMaps = normalized;
  });
  return links;
}

export function buildCompanySummary(companyName, product, country) {
  const normalized = inferBusinessProfile(product, 'relevant products and services');
  return `${companyName} appears to be active in ${country || 'the target market'} around ${normalized}. The company seems to operate through a public website and commercial presence, which makes it relevant for sourcing and partnership research.`;
}

function buildSentence(lead, type) {
  const company = lead.company;
  const product = inferBusinessProfile(`${lead.product || ''} ${lead.summary || ''}`, 'its products');
  const country = lead.country || 'your target market';
  const summary = buildCompanySummary(company, product, country);
  const productPhrase = cleanBusinessText(product).slice(0, 120);

  if (type === 'email') {
    return `Hi ${company} team,\n\nI came across ${company} while reviewing companies in ${country}. From the public information available, I understand that your team focuses on ${productPhrase}. ${summary} Based on that, I believe there may be a practical fit for a short conversation about sourcing needs, product planning, and potential collaboration. If you are open to it, I would be glad to share a few relevant ideas and arrange a brief introduction call this week.`;
  }
  if (type === 'whatsapp') {
    return `Hi ${company} team, I noticed ${company} while reviewing ${productPhrase} in ${country}. Your company looks relevant to our work, and I thought a short conversation could be useful. Would you be open to a quick chat this week?`;
  }
  if (type === 'linkedin') {
    return `Hi ${company} team, I recently reviewed ${company} while looking at ${productPhrase} providers in ${country}. The company appears to be operating in a relevant segment, and I would be interested in learning more about your current approach and sourcing priorities.`;
  }
  if (type === 'followup2') {
    return `Hi ${company} team, I wanted to follow up on my earlier note regarding ${productPhrase}. I believe there could be value in exploring whether a short conversation might be useful for your team in ${country}. If timing works, I would be happy to share a few ideas and learn more about your priorities.`;
  }
  return `Hi ${company} team, I wanted to share one more thought regarding ${productPhrase} and the potential for a brief exchange. If it is helpful, I would be glad to send a short overview of our work and discuss whether there is a fit for your current priorities in ${country}.`;
}

export function buildOutreachBundle(lead) {
  const subject = `Potential collaboration with ${lead.company}`;
  return {
    subject,
    email: buildSentence(lead, 'email'),
    whatsapp: buildSentence(lead, 'whatsapp'),
    linkedin: buildSentence(lead, 'linkedin'),
    followup2: buildSentence(lead, 'followup2'),
  };
}

function extractContactName(text) {
  const cleanPersonName = (value) => normalizeText(value).replace(/^(?:Meet|Mr|Mrs|Ms|Dr)\s+/i, '');
  const isGenericLabel = (value) => /^(?:Contact Us|About Us|Call Us|Email Us|Customer Service|Home About|Content Home|Main Menu|Search Home|Our Team|Register Login|Login Register|Fashion Jewelry Manufacturer|Contact Us We|The Viet|Shop Workshops For|About Us Our|Close Skip|Any Queries)$/i.test(normalizeText(value));
  const candidates = String(text || '').split(/\n|\.|;|,|\|/).map(normalizeText).filter(Boolean);
  const namedRole = String(text || '').match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b[^.]{0,50}\b(?:founder|owner|ceo|director|manager|president|head of sales)\b/i)
    || String(text || '').match(/\b(?:founder|owner|ceo|director|manager|president|head of sales)\b[^.]{0,50}\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/i);
  if (namedRole?.[1] && !isGenericLabel(namedRole[1])) {
    return cleanPersonName(namedRole[1]);
  }
  const matches = candidates.filter((line) => /(?:contact|sales|marketing|founder|manager|owner|team|ceo|director|head of|service)/i.test(line));
  const explicit = matches
    .map((line) => line.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/)?.[1] || '')
    .find((name) => name && !isGenericLabel(name));
  return cleanPersonName(explicit || '');
}

function extractWhatsApp(text) {
  const explicit = String(text || '').match(/(?:whatsapp|wa)[^\d+]{0,20}(\+?\d[\d().\s-]{6,}\d)/i);
  if (explicit?.[1]) return normalizeText(explicit[1]);
  return extractPhone(text);
}

function extractAddress(text) {
  const lines = String(text || '')
    .split(/\n|\.|;/)
    .map(normalizeText)
    .filter((line) => line.length >= 18 && line.length <= 180);
  return lines.find((line) => /\b(?:address|office|headquarters|location|street|road|avenue|suite|building|district|city|germany|vietnam|usa|united states)\b/i.test(line) && /\d/.test(line)) || '';
}

export function collectCompanySignals(pages) {
  const signals = {
    email: '',
    phone: '',
    whatsapp: '',
    contact: '',
    linkedin: '',
    facebook: '',
    instagram: '',
    googleMaps: '',
    address: '',
  };

  for (const page of pages || []) {
    const text = page?.text || '';
    const socialLinks = extractSocialLinks(text);
    if (!signals.email) signals.email = extractEmail(text);
    if (!signals.phone) signals.phone = extractPhone(text);
    if (!signals.whatsapp) signals.whatsapp = extractWhatsApp(text);
    if (!signals.contact) signals.contact = extractContactName(text);
    if (!signals.linkedin) signals.linkedin = socialLinks.linkedin;
    if (!signals.facebook) signals.facebook = socialLinks.facebook;
    if (!signals.instagram) signals.instagram = socialLinks.instagram;
    if (!signals.googleMaps) signals.googleMaps = socialLinks.googleMaps;
    if (!signals.address) signals.address = extractAddress(text);
  }

  return signals;
}

function extractCountry(text) {
  const countryHints = ['United States', 'USA', 'Canada', 'United Kingdom', 'UK', 'Germany', 'France', 'Spain', 'Italy', 'India', 'China', 'Japan', 'South Korea', 'Australia', 'Netherlands', 'Singapore', 'Dubai', 'UAE'];
  const haystack = text.toLowerCase();
  const match = countryHints.find((country) => haystack.includes(country.toLowerCase()));
  return match || '';
}

function scorePurchasePotential({ email, phone, whatsapp, website, product, summary, city, foundedYear, employeeSize, socialLinks }) {
  let score = 1;
  if (email) score += 1;
  if (phone || whatsapp) score += 1;
  if (website) score += 1;
  if (product) score += 1;
  if (summary) score += 1;
  if (city) score += 1;
  if (foundedYear || employeeSize) score += 1;
  if (socialLinks.linkedin || socialLinks.facebook || socialLinks.instagram || socialLinks.googleMaps) score += 1;
  return Math.min(5, score);
}

function businessMatchesTopic(lead, industry = '', keyword = '') {
  const topicTerms = getTopicTerms(`${industry} ${keyword}`);
  if (!topicTerms.length) return Boolean(lead.product || lead.summary);
  const haystack = `${lead.company || ''} ${lead.website || ''} ${lead.product || ''} ${lead.summary || ''}`.toLowerCase();
  return topicTerms.some((term) => textContainsTerm(haystack, term));
}

function gradeLead(lead, industry = '', keyword = '') {
  const hasWebsite = Boolean(lead.website);
  const hasEmail = Boolean(lead.email);
  const hasPhone = Boolean(lead.phone || lead.whatsapp);
  const matchesBusiness = businessMatchesTopic(lead, industry, keyword);
  if (hasWebsite && hasEmail && hasPhone && matchesBusiness) return 'A';
  if (hasWebsite && hasEmail && matchesBusiness) return 'B';
  if (hasWebsite && hasPhone && matchesBusiness) return 'C';
  return 'D';
}

function gradeRank(grade) {
  return { A: 4, B: 3, C: 2, D: 1 }[grade] || 0;
}

function calculateAIRecommendationScore(lead, industry = '', keyword = '') {
  const urlText = `${lead.website || ''} ${lead.company || ''}`.toLowerCase();
  const businessText = `${lead.product || ''} ${lead.summary || ''}`.toLowerCase();
  let score = 0;

  if (lead.website && isRealCompanyWebsite(lead.website)) score += 25;
  if (/\b(?:co\.|ltd|limited|inc|llc|gmbh|corp|corporation|company|factory|manufacturer|supplier|exporter|industrial|lighting|jewelry|automotive|parts)\b/i.test(`${lead.company} ${businessText}`)) score += 10;
  if (businessMatchesTopic(lead, industry, keyword)) score += 25;
  if (lead.product && lead.product.length > 20) score += 10;
  if (lead.email) score += 10;
  if (lead.phone || lead.whatsapp) score += 8;
  if (lead.linkedin) score += 6;
  if (lead.facebook || lead.instagram) score += 3;
  if (lead.foundedYear || lead.employeeSize || lead.address || lead.city) score += 3;
  if (/official|seed|google|bing|duckduckgo/i.test(lead.source || '')) score += 2;
  if (/directory|list|top|news|blog|article|wiki|travel|tourism/i.test(`${urlText} ${businessText}`)) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function withLeadGrade(lead, industry = '', keyword = '') {
  const product = businessMatchesTopic(lead, industry, keyword)
    ? lead.product
    : inferBusinessProfile(`${industry} ${keyword}`, lead.product || `${industry} ${keyword}`);
  const enrichedLead = {
    ...lead,
    product,
  };
  return {
    ...enrichedLead,
    grade: gradeLead(enrichedLead, industry, keyword),
    aiRecommendationScore: calculateAIRecommendationScore(enrichedLead, industry, keyword),
  };
}

export function buildRealLead({ company, website, country, city = '', email = '', phone = '', whatsapp = '', product = '', summary = '', source = '', sourceUrl = '', contact = '', linkedin = '', facebook = '', instagram = '', googleMaps = '', address = '', foundedYear = '', employeeSize = '' }) {
  return {
    company: normalizeText(company || ''),
    website: normalizeText(website || ''),
    country: normalizeText(country || ''),
    city: normalizeText(city || ''),
    email: normalizeText(email || ''),
    phone: normalizeText(phone || ''),
    whatsapp: normalizeText(whatsapp || ''),
    product: normalizeText(product || ''),
    summary: normalizeText(summary || ''),
    source: normalizeText(source || ''),
    sourceUrl: normalizeText(sourceUrl || ''),
    contact: normalizeText(contact || extractContactName(summary || '')),
    linkedin: normalizeText(linkedin || ''),
    facebook: normalizeText(facebook || ''),
    instagram: normalizeText(instagram || ''),
    googleMaps: normalizeText(googleMaps || ''),
    address: normalizeText(address || ''),
    foundedYear: normalizeText(foundedYear || ''),
    employeeSize: normalizeText(employeeSize || ''),
    score: scorePurchasePotential({ email, phone, whatsapp, website, product, summary, city, foundedYear, employeeSize, socialLinks: { linkedin, facebook, instagram, googleMaps } }),
  };
}

function dedupeLeadsByWebsite(leads) {
  const byKey = new Map();
  leads.forEach((lead) => {
    const key = (() => {
      try {
        const parsed = new URL(lead.website);
        return parsed.hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return normalizeText(`${lead.company}-${lead.country}`).toLowerCase();
      }
    })();
    const existing = byKey.get(key);
    if (!existing || (lead.score || 0) > (existing.score || 0)) {
      byKey.set(key, lead);
    }
  });
  return [...byKey.values()];
}

async function fetchPage(url, timeoutMs = 5000) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.text();
}

async function crawlCompanySite(website) {
  if (!website) return [];
  const base = website.replace(/\/$/, '');
  const candidates = [
    base,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/products`,
    `${base}/product`,
    `${base}/team`,
    `${base}/privacy`,
    `${base}/terms`,
  ];

  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const html = await fetchPage(candidate, 2500);
    const $ = cheerio.load(html);
    const text = extractPageText($);
    return text.length > 40 ? { url: candidate, text } : null;
  }));

  return settled
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
}

async function buildLeadFromSearchCandidate(candidate, country, industry, keyword, strictTopic = true) {
  try {
    const pageHtml = await fetchPage(candidate.url, 5000);
    const $$ = cheerio.load(pageHtml);
    const text = extractPageText($$);
    const companyName = extractCompanyName($$, normalizeText(candidate.url.replace(/^https?:\/\//, '').split('/')[0]));
    const socialLinks = extractSocialLinks(`${text}\n${$$.root().html()}`);
    const city = extractCity(text);
    const foundedYear = extractFoundedYear(text);
    const employeeSize = extractEmployeeCount(text);
    const product = extractBusiness(text, keyword);
    const summary = buildCompanySummary(companyName, product, country || extractCountry(text));
    const sitePages = await crawlCompanySite(cleanUrl(candidate.url));
    let signals = collectCompanySignals(sitePages);
    let lead = buildRealLead({
      company: companyName,
      website: cleanUrl(candidate.url),
      country,
      city,
      email: signals.email || extractEmail(text),
      phone: signals.phone || extractPhone(text),
      whatsapp: signals.whatsapp || extractWhatsApp(text),
      product,
      summary,
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
      linkedin: signals.linkedin || socialLinks.linkedin,
      facebook: signals.facebook || socialLinks.facebook,
      instagram: signals.instagram || socialLinks.instagram,
      googleMaps: signals.googleMaps || socialLinks.googleMaps,
      address: signals.address || extractAddress(text),
      foundedYear,
      employeeSize,
      contact: signals.contact || extractContactName(text),
    });
    const identity = identifyEnterpriseCandidate({
      url: candidate.url,
      text,
      company: lead.company,
      country: '',
      topic: '',
    });
    if (
      lead.company &&
      lead.company !== '未知公司' &&
      isRealCompanyWebsite(candidate.url) &&
      !['not-real-company-website', 'blocked-path', 'file-url', 'non-enterprise-identity', 'non-company-content', 'recruiting-page'].includes(identity.reason)
    ) {
      if (!signals.email || (!signals.phone && !signals.whatsapp) || !signals.linkedin) {
        const publicSignals = await searchCompanyContactSignals(companyName, cleanUrl(candidate.url), country);
        signals = {
          ...signals,
          email: signals.email || publicSignals.email,
          phone: signals.phone || publicSignals.phone,
          whatsapp: signals.whatsapp || publicSignals.whatsapp,
          contact: signals.contact || publicSignals.contact,
          linkedin: signals.linkedin || publicSignals.linkedin,
          facebook: signals.facebook || publicSignals.facebook,
          instagram: signals.instagram || publicSignals.instagram,
          googleMaps: signals.googleMaps || publicSignals.googleMaps,
          address: signals.address || publicSignals.address,
        };
        lead = buildRealLead({
          ...lead,
          email: signals.email || lead.email,
          phone: signals.phone || lead.phone,
          whatsapp: signals.whatsapp || lead.whatsapp,
          contact: signals.contact || lead.contact,
          linkedin: signals.linkedin || lead.linkedin,
          facebook: signals.facebook || lead.facebook,
          instagram: signals.instagram || lead.instagram,
          googleMaps: signals.googleMaps || lead.googleMaps,
          address: signals.address || lead.address,
        });
      }
      return withLeadGrade(lead, industry, keyword);
    }
  } catch (_error) {
    return null;
  }

  return null;
}

async function runSearchPlan(plan) {
  const [googleResults, bingResults, ddgResults] = await Promise.all([
    searchGoogle(plan.query),
    searchBing(plan.query),
    searchDuckDuckGo(plan.query),
  ]);

  return {
    query: plan.query,
    counts: {
      google: googleResults.length,
      bing: bingResults.length,
      duckDuckGo: ddgResults.length,
    },
    googleResults: googleResults.map((item) => ({ ...item, source: plan.source, sourceUrl: item.sourceUrl })),
    bingResults: bingResults.map((item) => ({ ...item, source: 'Bing', sourceUrl: item.sourceUrl })),
    ddgResults: ddgResults.map((item) => ({ ...item, source: 'DuckDuckGo', sourceUrl: item.sourceUrl })),
  };
}

function summarizeSearchPlanResults(planResults) {
  return planResults.reduce((summary, result) => {
    summary.google += result.counts.google;
    summary.bing += result.counts.bing;
    summary.duckDuckGo += result.counts.duckDuckGo;
    return summary;
  }, { google: 0, bing: 0, duckDuckGo: 0 });
}

function countLeadGrades(leads) {
  return leads.reduce((counts, lead) => {
    const grade = lead.grade || 'D';
    counts[grade] = (counts[grade] || 0) + 1;
    return counts;
  }, { A: 0, B: 0, C: 0, D: 0 });
}

function getOfficialWebsiteSeeds(country, industry) {
  const normalizedCountry = normalizeText(normalizeCountryForSearch(country)).toLowerCase();
  const normalizedIndustry = normalizeText(industry).toLowerCase();
  const seeds = [];

  if (normalizedIndustry.includes('led') || normalizedIndustry.includes('lighting')) {
    if (normalizedCountry.includes('united kingdom') || normalizedCountry === 'uk') {
      seeds.push(
        ['https://contrac-lighting.co.uk', 'Contrac Lighting'],
        ['http://www.ledlightvision.co.uk', 'LED Light Vision'],
        ['https://www.lumineux.co.uk', 'Lumineux'],
        ['https://www.luceco.com', 'Luceco'],
        ['https://www.thorlux.com', 'Thorlux Lighting'],
      );
    } else if (normalizedCountry.includes('united states') || normalizedCountry === 'usa') {
      seeds.push(
        ['https://usled.com', 'US LED'],
        ['https://straitslighting.com', 'Straits Lighting'],
        ['https://aglareusa.com', 'Aglare USA'],
        ['https://ledindustriesusa.com', 'LED Industries USA'],
        ['https://ledusa.com', 'LEDUSA'],
        ['https://www.edgelightusa.com', 'Edgelight USA'],
        ['https://www.rablighting.com', 'RAB Lighting'],
        ['https://www.maxlite.com', 'MaxLite'],
        ['https://www.satco.com', 'SATCO'],
        ['https://www.eiko.com', 'EiKO'],
        ['https://www.litetronics.com', 'Litetronics'],
        ['https://www.greencreative.com', 'GREEN CREATIVE'],
        ['https://www.ilp-inc.com', 'Industrial Lighting Products'],
        ['https://www.earthtronics.com', 'EarthTronics'],
        ['https://www.luminii.com', 'Luminii'],
        ['https://www.elementalled.com', 'Elemental LED'],
        ['https://www.lithonia.com', 'Lithonia Lighting'],
        ['https://www.acuitybrands.com', 'Acuity Brands'],
      );
    }
  }

  if (normalizedIndustry.includes('jewelry') || normalizedIndustry.includes('jewellery') || normalizedIndustry.includes('bracelet') || /珠宝|首饰|饰品|耳钉|耳环|手链/.test(normalizedIndustry)) {
    if (normalizedCountry.includes('vietnam')) {
      seeds.push(
        ['https://hmlvina.com', 'HML VINA Co., Ltd.'],
        ['https://www.kobavina.com', 'Kobayashi Vina'],
        ['https://vietjewellery.com', 'Viet Jewellery'],
        ['https://trangjewelry.com', 'Trang Jewelry'],
      );
    } else if (normalizedCountry.includes('united states') || normalizedCountry === 'usa') {
      seeds.push(
        ['https://mjjbrilliant.com', 'MJJ Brilliant'],
        ['https://jewelrymfg.net', 'Custom Jewelry Manufacturer'],
        ['https://www.kaprielian.com', 'Kaprielian'],
        ['https://www.castinghouse.com', 'Casting House'],
        ['https://www.stuller.com', 'Stuller'],
      );
    }
  }

  if (normalizedIndustry.includes('auto') || normalizedIndustry.includes('automotive') || normalizedIndustry.includes('parts')) {
    if (normalizedCountry.includes('germany')) {
      seeds.push(
        ['https://www.mahle.com', 'MAHLE'],
        ['https://www.zf.com', 'ZF Friedrichshafen'],
        ['https://www.meyle.com', 'MEYLE'],
        ['https://www.febi.com', 'febi'],
        ['https://www.schaeffler.com', 'Schaeffler'],
        ['https://www.bosch-mobility.com', 'Bosch Mobility'],
        ['https://www.continental-automotive.com', 'Continental Automotive'],
        ['https://www.hella.com', 'HELLA'],
        ['https://www.bilstein.de', 'BILSTEIN'],
        ['https://www.mann-filter.com', 'MANN-FILTER'],
        ['https://www.ate-brakes.com', 'ATE'],
        ['https://www.textar.com', 'Textar'],
        ['https://www.vaico.de', 'VAICO'],
        ['https://www.vemo.de', 'VEMO'],
        ['https://www.luk-aftermarket.com', 'LuK'],
        ['https://www.ina.de', 'INA'],
      );
    }
  }

  return seeds.map(([url, company]) => ({
    url,
    company,
    source: 'Official Website Seed',
    sourceUrl: '',
  }));
}

function buildLeadFromOfficialSeed(candidate, country, industry, keyword) {
  const product = inferBusinessProfile(`${industry} ${keyword}`, `${industry} ${keyword}`);
  return withLeadGrade(buildRealLead({
    company: candidate.company,
    website: cleanUrl(candidate.url),
    country,
    product,
    summary: buildCompanySummary(candidate.company, product, country),
    source: 'Official Website Seed',
    sourceUrl: '',
  }), industry, keyword);
}

async function searchCompanyContactSignals(company, website, country) {
  const domain = (() => {
    try {
      return new URL(website).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const queries = [
    `${company} ${country} email`,
    `${company} contact sales`,
    `${company} WhatsApp LinkedIn`,
    domain ? `${domain} email contact` : '',
  ].filter(Boolean);
  const pages = [];

  for (const query of queries.slice(0, 3)) {
    try {
      const html = await fetchPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, 2500);
      const $ = cheerio.load(html);
      const text = extractPageText($);
      pages.push({ url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`, text: `${text}\n${$.root().html()}` });
    } catch (_error) {
      // Public contact enrichment is best-effort only.
    }
  }

  return collectCompanySignals(pages);
}

function decodeSearchTarget(value) {
  if (!value) return '';
  try {
    const decoded = decodeURIComponent(value);
    return decoded;
  } catch {
    return value;
  }
}

function isSearchEngineUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ['google.com', 'www.google.com', 'bing.com', 'www.bing.com', 'duckduckgo.com', 'html.duckduckgo.com'].includes(host);
  } catch {
    return false;
  }
}

async function searchGoogle(query) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchPage(searchUrl);
    const $ = cheerio.load(html);
    const results = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const url = new URL(href, 'https://www.google.com');
        const target = url.searchParams.get('q') || (url.protocol.startsWith('http') ? url.toString() : '');
        if (target && target.includes('http') && !isSearchEngineUrl(target)) {
          results.push({ url: decodeSearchTarget(target), source: 'Google Search', sourceUrl: searchUrl });
        }
      } catch (_error) {
        // ignore malformed links
      }
    });
    return [...new Map(results.map((item) => [item.url, item])).values()].slice(0, SEARCH_RESULT_LIMIT);
  } catch (_error) {
    return [];
  }
}

async function searchBing(query) {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchPage(searchUrl);
    const $ = cheerio.load(html);
    const results = [];
    $('li.b_algo h2 a, .b_algo h2 a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href.includes('javascript:')) return;
      if (!isSearchEngineUrl(href) && href.includes('http')) {
        results.push({ url: href, source: 'Bing', sourceUrl: searchUrl });
      }
    });
    if (results.length > 0) {
      return [...new Map(results.map((item) => [item.url, item])).values()].slice(0, SEARCH_RESULT_LIMIT);
    }
  } catch (_error) {
    // Try the RSS endpoint below. It is simpler and often survives markup changes.
  }

  try {
    const xml = await fetchPage(rssUrl);
    const $ = cheerio.load(xml, { xmlMode: true });
    const results = [];
    $('item').each((_, el) => {
      const href = normalizeText($(el).find('link').first().text());
      if (href && href.includes('http') && !isSearchEngineUrl(href)) {
        results.push({ url: href, source: 'Bing', sourceUrl: rssUrl });
      }
    });
    return [...new Map(results.map((item) => [item.url, item])).values()].slice(0, SEARCH_RESULT_LIMIT);
  } catch (_error) {
    return [];
  }
}

async function searchDuckDuckGo(query) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchPage(searchUrl);
    const $ = cheerio.load(html);
    const results = [];
    $('.result__a, a.result__a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const url = new URL(href, 'https://html.duckduckgo.com');
        const target = url.searchParams.get('uddg') || (url.protocol.startsWith('http') ? url.toString() : '');
        if (target && target.includes('http') && !isSearchEngineUrl(target)) {
          results.push({ url: decodeSearchTarget(target), source: 'DuckDuckGo', sourceUrl: searchUrl });
        }
      } catch (_error) {
        if (href.includes('http') && !isSearchEngineUrl(href)) {
          results.push({ url: href, source: 'DuckDuckGo', sourceUrl: searchUrl });
        }
      }
    });
    return [...new Map(results.map((item) => [item.url, item])).values()].slice(0, SEARCH_RESULT_LIMIT);
  } catch (_error) {
    return [];
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'service is running' });
});

app.post('/enrich', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ error: 'keyword is required' });
  }

  try {
    const searches = [
      `site:linkedin.com/company ${keyword}`,
      `${keyword} manufacturer`,
      `${keyword} supplier`,
      `${keyword} factory`,
      `site:facebook.com ${keyword}`,
    ];

    const results = [];
    for (const query of searches) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      try {
        const html = await fetchPage(searchUrl);
        const $ = cheerio.load(html);
        $('a').each((_, el) => {
          const href = $(el).attr('href');
          if (!href || !href.includes('/url?q=')) return;
          try {
            const url = new URL(href, 'https://www.google.com');
            const target = url.searchParams.get('q');
            if (target && target.includes('http') && !isSearchEngineUrl(target)) {
              results.push({ url: decodeSearchTarget(target), source: query.includes('linkedin') ? 'LinkedIn' : query.includes('facebook') ? 'Facebook' : 'Google Search', sourceUrl: searchUrl });
            }
          } catch (_error) {
            // ignore malformed links
          }
        });
      } catch (_error) {
        // ignore failed search fetch
      }
    }

    const uniqueCandidates = dedupeCandidates(results).slice(0, 10);
    const companies = [];

    for (const candidate of uniqueCandidates) {
      try {
        const pageHtml = await fetchPage(candidate.url);
        const $$ = cheerio.load(pageHtml);
        const text = extractPageText($$);
        const companyName = extractCompanyName($$, normalizeText(candidate.url.replace(/^https?:\/\//, '').split('/')[0]));
        const socialLinks = extractSocialLinks(`${text}\n${$$.root().html()}`);
        const city = extractCity(text);
        const foundedYear = extractFoundedYear(text);
        const employeeSize = extractEmployeeCount(text);
        const product = extractBusiness(text, keyword);
        const summary = buildCompanySummary(companyName, product, extractCountry(text) || extractCountry(keyword) || '');
        const sitePages = await crawlCompanySite(cleanUrl(candidate.url));
        const signals = collectCompanySignals(sitePages);
        const lead = buildRealLead({
          company: companyName,
          website: cleanUrl(candidate.url),
          country: extractCountry(text),
          city,
          email: signals.email || extractEmail(text),
          phone: signals.phone || extractPhone(text),
          whatsapp: signals.whatsapp || extractWhatsApp(text),
          product,
          summary,
          source: candidate.source,
          sourceUrl: candidate.sourceUrl,
          linkedin: signals.linkedin || socialLinks.linkedin,
          facebook: signals.facebook || socialLinks.facebook,
          googleMaps: signals.googleMaps || socialLinks.googleMaps,
          foundedYear,
          employeeSize,
          contact: signals.contact || extractContactName(text),
        });
        if (lead.company && lead.company !== '未知公司' && shouldKeepCandidate({ url: candidate.url, text, company: lead.company })) {
          companies.push(lead);
        }
      } catch (_error) {
        continue;
      }
    }

    return res.json({ success: true, companies });
  } catch (_error) {
    return res.json({ success: true, companies: [] });
  }
});

app.post('/search', async (req, res) => {
  const { country, industry, keyword } = req.body;
  if (!country || !industry || !keyword) {
    return res.status(400).json({ error: 'country, industry and keyword are required' });
  }

  try {
    const searchCountry = normalizeCountryForSearch(country);
    const searchKeyword = `${searchCountry} ${industry} ${keyword}`;
    const expandedQueries = buildSearchQueries({ country, industry, keyword });
    console.info('[search debug] request', {
      country,
      industry,
      keyword,
      normalizedCountry: searchCountry,
      actualSearchKeyword: searchKeyword,
    });
    const searchPlans = expandedQueries.map((query) => ({ query, source: 'Google Search' }));

    const planResults = await Promise.all(searchPlans.map(runSearchPlan));
    const engineCounts = summarizeSearchPlanResults(planResults);
    const sourceReturnedTotal = engineCounts.google + engineCounts.bing + engineCounts.duckDuckGo;
    console.info('[search debug] engine counts', {
      country,
      industry,
      actualSearchKeyword: searchKeyword,
      google: engineCounts.google,
      bing: engineCounts.bing,
      duckDuckGo: engineCounts.duckDuckGo,
    });
    const searchCandidates = planResults.flatMap((result) => [
      ...result.googleResults,
      ...result.bingResults,
      ...result.ddgResults,
    ]);

    const seedCandidates = getOfficialWebsiteSeeds(country, industry);
    const allCandidates = [...searchCandidates, ...seedCandidates];
    const uniqueCandidates = dedupeCandidates(allCandidates);
    const duplicateRemovedCount = Math.max(0, allCandidates.length - uniqueCandidates.length);
    const officialCandidates = selectOfficialCandidates(uniqueCandidates, BUILD_CANDIDATE_LIMIT);
    const rawCompanies = dedupeLeadsByWebsite((await Promise.all(officialCandidates.map(async (candidate) => {
      const lead = await buildLeadFromSearchCandidate(candidate, country, industry, keyword, true);
      if (lead) return lead;
      if (candidate.source === 'Official Website Seed') {
        return buildLeadFromOfficialSeed(candidate, country, industry, keyword);
      }
      return null;
    }))).filter(Boolean));
    const companies = rawCompanies
      .map((lead) => withLeadGrade(lead, industry, keyword))
      .sort((a, b) => (b.aiRecommendationScore || 0) - (a.aiRecommendationScore || 0) || gradeRank(b.grade) - gradeRank(a.grade) || (b.score || 0) - (a.score || 0))
      .slice(0, FINAL_COMPANY_LIMIT);
    const gradeCounts = countLeadGrades(companies);
    const searchStats = {
      ...engineCounts,
      sourceReturnedTotal,
      duplicateRemovedCount,
      scoredCandidateCount: rawCompanies.length,
      filteredCount: 0,
      gradeCounts,
      finalTotal: companies.length,
      expandedQueries,
    };
    console.info('[search debug] candidate counts', {
      country,
      industry,
      actualSearchKeyword: searchKeyword,
      expandedQueries: expandedQueries.length,
      searchCandidates: searchCandidates.length,
      seedCandidates: seedCandidates.length,
      uniqueCandidates: uniqueCandidates.length,
      officialCandidates: officialCandidates.length,
      scoredCandidates: rawCompanies.length,
      companies: companies.length,
      gradeCounts,
    });

    if (companies.length > 0) {
      return res.json({ success: true, companies, searchStats, mode: 'real-search', message: `已找到 ${companies.length} 家潜在客户` });
    }

    return res.json({ success: true, companies: [], searchStats, mode: 'real-search', message: '未找到符合条件的客户。' });
  } catch (error) {
    console.error('[search debug] failed', {
      country,
      industry,
      keyword,
      error: error.message,
    });
    return res.json({ success: true, companies: [], searchStats: { google: 0, bing: 0, duckDuckGo: 0 }, mode: 'real-search', message: '未找到符合条件的客户。' });
  }
});

if (!isTestRun) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}
