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
const HOST = process.env.HOST || '0.0.0.0';
const isTestRun = process.env.NODE_ENV === 'test' || process.env.SKIP_SERVER_START === '1' || process.argv.some((arg) => arg.includes('node:test'));
const SEARCH_RESULT_LIMIT = 20;
const FINAL_COMPANY_LIMIT = 20;
const BUILD_CANDIDATE_LIMIT = 80;

export const INDUSTRY_KEYWORD_LIBRARY = {
  Jewelry: [
    'Jewelry manufacturer',
    'Jewelry supplier',
    'Jewelry wholesaler',
    'Jewelry exporter',
    'Jewelry factory',
    'OEM jewelry',
    'Fashion jewelry',
    'Silver jewelry',
    'Gold jewelry',
    'Custom jewelry',
    'Jewelry company',
    'Jewelry distributor',
    'Wholesale jewelry',
    'Wholesale jewellery',
    'Jewellery manufacturer',
    'Jewellery supplier',
    'Jewellery wholesaler',
    'Jewellery exporter',
    'Jewellery factory',
    'Fashion accessories supplier',
  ],
  'LED Lighting': [
    'LED manufacturer',
    'LED supplier',
    'LED lighting manufacturer',
    'LED lighting supplier',
    'Commercial lighting',
    'Industrial lighting',
    'Lighting factory',
    'Lighting exporter',
    'LED fixture manufacturer',
    'LED lamp supplier',
    'Lighting solutions company',
    'OEM LED lighting',
    'ODM LED lighting',
    'LED distributor',
    'Architectural lighting',
    'Outdoor LED lighting',
    'Indoor LED lighting',
    'Commercial LED lighting',
    'Industrial LED lighting',
    'LED lighting company',
  ],
  Furniture: [
    'Furniture manufacturer',
    'Furniture supplier',
    'Furniture exporter',
    'Furniture factory',
    'Furniture wholesaler',
    'Furniture company',
    'Furniture distributor',
    'OEM furniture',
    'Custom furniture',
    'Wood furniture manufacturer',
    'Commercial furniture supplier',
    'Hotel furniture manufacturer',
    'Office furniture supplier',
    'Home furniture manufacturer',
    'Outdoor furniture supplier',
    'Furniture production',
    'Furniture workshop',
    'Furniture trading company',
    'Furniture products',
    'Furniture catalog',
  ],
  'Auto Parts': [
    'Auto Parts manufacturer',
    'Auto Parts supplier',
    'Auto Parts exporter',
    'OEM Auto Parts',
    'Auto Parts factory',
    'Auto Parts distributor',
    'Automotive parts manufacturer',
    'Automotive parts supplier',
    'Aftermarket parts supplier',
    'Vehicle parts distributor',
    'Spare parts supplier',
    'Car parts manufacturer',
    'Car parts supplier',
    'Automotive components manufacturer',
    'OEM automotive parts',
    'Auto components exporter',
    'Automotive aftermarket supplier',
    'Engine parts supplier',
    'Brake parts supplier',
    'Suspension parts supplier',
  ],
  Packaging: [
    'Packaging manufacturer',
    'Packaging supplier',
    'Packaging exporter',
    'Packaging factory',
    'Packaging wholesaler',
    'Custom packaging',
    'OEM packaging',
    'Paper packaging supplier',
    'Plastic packaging manufacturer',
    'Food packaging supplier',
    'Cosmetic packaging supplier',
    'Flexible packaging manufacturer',
    'Packaging company',
    'Packaging distributor',
    'Printed packaging supplier',
    'Retail packaging supplier',
    'Sustainable packaging supplier',
    'Packaging products',
    'Packaging solutions company',
    'Packaging production',
  ],
  Cosmetics: [
    'Cosmetics manufacturer',
    'Beauty supplier',
    'Skincare manufacturer',
    'Cosmetics supplier',
    'Cosmetics exporter',
    'Cosmetics factory',
    'OEM cosmetics',
    'Private label cosmetics',
    'Beauty products manufacturer',
    'Skincare supplier',
    'Makeup manufacturer',
    'Personal care manufacturer',
    'Cosmetic products supplier',
    'Cosmetics company',
    'Cosmetics distributor',
    'Beauty products exporter',
    'Skincare factory',
    'Natural cosmetics manufacturer',
    'Cosmetic formulation company',
    'Beauty brand manufacturer',
  ],
};

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

export function normalizeIndustryForSearch(industry) {
  const value = normalizeText(industry).toLowerCase();
  if (/(珠宝|首饰|饰品|耳钉|耳环|耳饰|手镯|手链|项链|戒指|jewelry|jewellery|earring|bracelet|necklace|ring|accessor)/i.test(value)) {
    return 'Jewelry';
  }
  if (/(led|lighting|灯|照明|lamp|fixture|luminair)/i.test(value)) {
    return 'LED Lighting';
  }
  if (/(auto|automotive|vehicle|spare|parts|汽配|汽车配件|零部件)/i.test(value)) {
    return 'Auto Parts';
  }
  if (/(furniture|家具|家居|chair|table|cabinet|sofa)/i.test(value)) {
    return 'Furniture';
  }
  if (/(packaging|package|packing|包装|包裝|box|carton|bag|label)/i.test(value)) {
    return 'Packaging';
  }
  if (/(cosmetic|cosmetics|beauty|skincare|makeup|化妆品|化妝品|美妆|美妝|护肤|護膚)/i.test(value)) {
    return 'Cosmetics';
  }
  return normalizeText(industry);
}

export function buildSearchQueries({ country, industry }) {
  const normalizedCountry = normalizeCountryForSearch(country);
  const normalizedIndustry = normalizeIndustryForSearch(industry);
  const countryPrefix = normalizeText(normalizedCountry);
  const libraryTerms = INDUSTRY_KEYWORD_LIBRARY[normalizedIndustry] || [
    `${normalizedIndustry} manufacturer`,
    `${normalizedIndustry} supplier`,
    `${normalizedIndustry} wholesaler`,
    `${normalizedIndustry} exporter`,
    `${normalizedIndustry} factory`,
    `OEM ${normalizedIndustry}`,
    `${normalizedIndustry} distributor`,
    `${normalizedIndustry} company`,
  ];
  const expanded = libraryTerms.map((term) => `${countryPrefix} ${term}`);

  return [...new Set(expanded.map(normalizeText).filter(Boolean))].slice(0, 20);
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
  if (/(jewelry|jewellery|bracelet|necklace|ring|accessor)/i.test(haystack)) {
    return 'fashion jewelry, custom pieces, wholesale accessories, and retail-ready jewelry products';
  }
  if (/(led|lighting|lamp|fixture|luminair|illumination)/i.test(haystack)) {
    return 'commercial and industrial LED lighting solutions, including indoor and outdoor fixtures, lamps, controls, and project lighting products';
  }
  if (/(furniture|chair|table|cabinet|sofa|wood)/i.test(haystack)) {
    return 'furniture, fixtures, and interior product supply for commercial or retail buyers';
  }
  if (/(packaging|package|carton|box|bag|label|pouch|container)/i.test(haystack)) {
    return 'custom packaging, retail packaging, printed boxes, bags, labels, and packaging solutions for brands and distributors';
  }
  if (/(cosmetic|cosmetics|skincare|beauty|makeup|personal care|lotion|cream|serum)/i.test(haystack)) {
    return 'cosmetics, skincare, beauty products, personal care items, and private-label product manufacturing';
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
    .filter((sentence) => /(manufactur|supplier|provider|solutions|products|services|systems|design|lighting|furniture|hardware|industrial|engineering|wholesale|export|trading|components|assembly|packaging|cosmetic|skincare|beauty|automotive|auto parts)/i.test(sentence))
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
  'supplierscentral.com',
  'united.com',
  'expedia.com',
  'tripadvisor.com',
  'booking.com',
  'kayak.com',
  'baidu.com',
  'google.com',
  'google.co.uk',
  'google.com.au',
  'google.co.jp',
  'google.de',
  'dingtalk.com',
  'apple.com',
  'apps.apple.com',
  'microsoft.com',
  'mozilla.org',
  'yahoo.co.jp',
  'yahoo-net.jp',
  'gizmodo.com',
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
const UNRELATED_BUSINESS_PATTERNS = [
  /\bsoftware\b/i,
  /\bdata science\b/i,
  /\bdata analytics\b/i,
  /\bit service\b/i,
  /\binformation technology\b/i,
  /\bgaming\b/i,
  /\bxbox\b/i,
  /\beducation\b/i,
  /\bgovernment\b/i,
  /\bnews\b/i,
  /\bblog\b/i,
  /\bdirectory\b/i,
  /\bforum\b/i,
  /\bagency\b/i,
  /\bconsulting\b/i,
];

function isBlockedHost(host) {
  if (/^google\.[a-z.]+$/i.test(host) || /^www\.google\.[a-z.]+$/i.test(host)) return true;
  if (/^(www\.)?youtube\.[a-z.]+$/i.test(host)) return true;
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
    packaging: ['packaging', 'package', 'box', 'carton', 'bag', 'label', 'pouch', 'container'],
    cosmetics: ['cosmetics', 'cosmetic', 'beauty', 'skincare', 'makeup', 'personal', 'care'],
    cosmetic: ['cosmetics', 'cosmetic', 'beauty', 'skincare', 'makeup', 'personal', 'care'],
    skincare: ['cosmetics', 'cosmetic', 'beauty', 'skincare', 'makeup', 'personal', 'care'],
    hardware: ['hardware', 'tool', 'fastener', 'component', 'industrial'],
  };
  const baseTerms = normalizeText(topic)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !['and', 'the', 'for', 'with', 'company', 'manufacturer', 'supplier', 'factory', 'exporter', 'oem'].includes(term));
  return [...new Set(baseTerms.flatMap((term) => [term, ...(aliases[term] || [])]))];
}

function getIndustryMatchProfile(industry = '', keyword = '') {
  const input = `${industry} ${keyword}`.toLowerCase();
  if (/(jewelry|jewellery|earring|bracelet|necklace|ring|accessor|珠宝|首饰|饰品|耳钉|耳环|手镯|手链|项链|戒指)/i.test(input)) {
    return {
      type: 'jewellery',
      strongTerms: [
        'jewelry',
        'jewellery',
        'earrings',
        'stud earrings',
        'fashion jewelry',
        'fashion jewellery',
        'silver jewelry',
        'gold jewelry',
        'bracelet',
        'necklace',
        'ring',
        'accessories',
        'wholesale jewelry',
        'wholesale jewellery',
        'jewellery supplier',
        'jewellery manufacturer',
        'jewelry supplier',
        'jewelry manufacturer',
        'oem jewelry',
        'oem jewellery',
      ],
      preferredTerms: [
        'jewelry brand',
        'jewellery brand',
        'wholesaler',
        'manufacturer',
        'supplier',
        'factory',
        'exporter',
        'oem',
        'odm',
      ],
    };
  }
  if (/(led|lighting|lamp|fixture|luminair|illumination)/i.test(input)) {
    return {
      type: 'lighting',
      strongTerms: ['led', 'lighting', 'led lighting', 'lamp', 'fixture', 'luminaire', 'illumination'],
      preferredTerms: ['manufacturer', 'supplier', 'factory', 'industrial', 'commercial', 'oem', 'lighting solutions'],
    };
  }
  if (/(furniture|chair|table|cabinet|sofa|wood)/i.test(input)) {
    return {
      type: 'furniture',
      strongTerms: ['furniture manufacturer', 'furniture supplier', 'furniture factory', 'furniture exporter', 'wood furniture', 'office furniture', 'hotel furniture', 'furniture products', 'furniture company'],
      preferredTerms: ['manufacturer', 'supplier', 'factory', 'wholesaler', 'exporter', 'oem', 'custom'],
    };
  }
  if (/(auto parts|automotive|vehicle|spare|parts|aftermarket|component)/i.test(input)) {
    return {
      type: 'auto-parts',
      strongTerms: ['auto parts', 'automotive parts', 'vehicle parts', 'spare parts', 'aftermarket parts', 'car parts', 'automotive components', 'auto components', 'oem automotive parts'],
      preferredTerms: ['manufacturer', 'supplier', 'factory', 'exporter', 'oem', 'aftermarket', 'distributor'],
    };
  }
  if (/(packaging|package|carton|box|bag|label|pouch|container)/i.test(input)) {
    return {
      type: 'packaging',
      strongTerms: ['packaging', 'package', 'carton', 'box', 'bag', 'label', 'pouch', 'container', 'printed packaging'],
      preferredTerms: ['manufacturer', 'supplier', 'factory', 'exporter', 'custom', 'oem', 'solutions'],
    };
  }
  if (/(cosmetic|cosmetics|beauty|skincare|makeup|personal care)/i.test(input)) {
    return {
      type: 'cosmetics',
      strongTerms: ['cosmetics', 'cosmetic', 'beauty', 'skincare', 'makeup', 'personal care', 'cream', 'serum', 'lotion'],
      preferredTerms: ['manufacturer', 'supplier', 'factory', 'exporter', 'oem', 'private label', 'formulation'],
    };
  }
  return {
    type: 'general',
    strongTerms: getTopicTerms(`${industry} ${keyword}`),
    preferredTerms: ['manufacturer', 'supplier', 'factory', 'exporter', 'oem', 'odm', 'wholesale'],
  };
}

export function calculateIndustryMatchScore({ url = '', company = '', text = '' }, industry = '', keyword = '') {
  const profile = getIndustryMatchProfile(industry, keyword);
  const haystack = normalizeText(`${company} ${url} ${text}`).toLowerCase();
  if (!profile.strongTerms.length) return 70;
  if (UNRELATED_BUSINESS_PATTERNS.some((pattern) => pattern.test(haystack))) return 0;

  let score = 0;
  const strongMatches = profile.strongTerms.filter((term) => textContainsTerm(haystack, term.toLowerCase()));
  if (strongMatches.length > 0) score += 55;
  if (strongMatches.length >= 2) score += 15;
  if (strongMatches.length >= 4) score += 10;
  if (profile.preferredTerms.some((term) => textContainsTerm(haystack, term.toLowerCase()))) score += 15;
  if (/\b(?:manufacturer|supplier|factory|wholesale|wholesaler|exporter|oem|odm)\b/i.test(haystack)) score += 5;

  return Math.max(0, Math.min(100, score));
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

export function calculateCountryFitScore({ url = '', company = '', text = '' }, country = '') {
  const target = normalizeCountryForSearch(country).toLowerCase();
  const identityText = normalizeText(`${company} ${url}`).toLowerCase();
  const pageText = normalizeText(text).toLowerCase();
  const countryGroups = [
    { key: 'united states', signals: ['united states', 'usa', 'u.s.', '.us', '+1'] },
    { key: 'united kingdom', signals: ['united kingdom', 'uk', '.co.uk', '+44'] },
    { key: 'vietnam', signals: ['vietnam', 'viet nam', '.vn', '+84', 'hanoi', 'ho chi minh', 'saigon'] },
    { key: 'germany', signals: ['germany', 'deutschland', '.de', '+49'] },
    { key: 'japan', signals: ['japan', '.jp', '+81', 'tokyo', 'osaka'] },
    { key: 'india', signals: ['india', '.in', '+91'] },
    { key: 'china', signals: ['china', '.cn', '+86'] },
    { key: 'bangladesh', signals: ['bangladesh', '.bd', '+880'] },
    { key: 'pakistan', signals: ['pakistan', '.pk', '+92'] },
  ];
  const targetGroup = countryGroups.find((group) => group.key === target || group.signals.includes(target));
  const targetSignals = targetGroup?.signals || getCountrySignals(country);
  const hasTargetSignal = targetSignals.some((signal) => identityText.includes(signal) || pageText.includes(signal));
  const identityMismatch = countryGroups
    .filter((group) => group.key !== targetGroup?.key)
    .some((group) => group.signals.some((signal) => identityText.includes(signal)));
  const pageMismatch = countryGroups
    .filter((group) => group.key !== targetGroup?.key)
    .some((group) => group.signals.some((signal) => pageText.includes(signal)));

  if (identityMismatch) return 0;
  if (hasTargetSignal) return 100;
  if (pageMismatch && !hasTargetSignal) return 35;
  return 60;
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

function scoreOfficialCandidate(candidate, industry = '') {
  try {
    const parsed = new URL(candidate.url || '');
    const path = parsed.pathname.replace(/\/+$/, '');
    const pathDepth = path.split('/').filter(Boolean).length;
    const source = candidate.source || '';
    const haystack = `${candidate.company || ''} ${candidate.url || ''}`.toLowerCase();
    const topicTerms = getTopicTerms(industry);

    let score = 0;
    if (source === 'Official Website Seed') score += 1000;
    if (topicTerms.some((term) => textContainsTerm(haystack, term))) score += 160;
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

export function selectOfficialCandidates(candidates, limit = 12, industry = '') {
  return candidates
    .filter((candidate) => isRealCompanyWebsite(candidate.url))
    .map((candidate, index) => ({ candidate, index, score: scoreOfficialCandidate(candidate, industry) }))
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
  const cleanPersonName = (value) => normalizeText(value)
    .replace(/^(?:Meet|Mr|Mrs|Ms|Dr)\s+/i, '')
    .replace(/\s+(?:Sales|Export|Purchasing|Procurement|Marketing|Business|Development|General|Manager|Director|CEO|Owner|Founder|President|Officer|Head)$/i, '');
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

function extractContactTitle(text) {
  const match = String(text || '').match(/\b(?:founder|owner|ceo|chief executive officer|director|sales manager|export manager|purchasing manager|procurement manager|head of sales|business development manager|marketing manager|general manager)\b/i);
  return match ? normalizeText(match[0]) : '';
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
    contactTitle: '',
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
    if (!signals.contactTitle) signals.contactTitle = extractContactTitle(text);
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

function hasContactSignal(lead) {
  return Boolean(lead.email || lead.phone || lead.whatsapp || lead.linkedin || lead.contact);
}

export function calculateCompanyScore(lead, industry = '', keyword = '') {
  let score = 0;
  const countryFitScore = lead.countryFitScore ?? 60;
  if (lead.website && isRealCompanyWebsite(lead.website)) score += 25;
  if (countryFitScore >= 80) score += 18;
  else if (countryFitScore >= 50) score += 8;
  if (lead.industryMatchScore) score += Math.round(lead.industryMatchScore * 0.25);
  if ((lead.industryMatchScore || 0) >= 50 || businessMatchesTopic(lead, industry, keyword)) score += 12;
  if (lead.product && lead.product.length > 20) score += 10;
  if (/\b(?:export|exporter|global|international|worldwide|overseas)\b/i.test(`${lead.product || ''} ${lead.summary || ''}`)) score += 8;
  if (/\b(?:oem|odm|private label|custom|factory|manufacturer)\b/i.test(`${lead.company || ''} ${lead.product || ''} ${lead.summary || ''}`)) score += 7;
  return Math.max(0, Math.min(100, score));
}

export function calculateContactCompletenessScore(lead) {
  let score = 0;
  if (lead.email) score += 30;
  if (lead.phone) score += 20;
  if (lead.whatsapp) score += 20;
  if (lead.linkedin) score += 15;
  if (lead.contact) score += 10;
  if (lead.contactTitle) score += 5;
  if (lead.facebook || lead.instagram || lead.googleMaps || lead.address) score += 5;
  return Math.max(0, Math.min(100, score));
}

function gradeLead(lead, industry = '', keyword = '') {
  const hasWebsite = Boolean(lead.website);
  const matchesBusiness = (lead.industryMatchScore || 0) >= 50 || businessMatchesTopic(lead, industry, keyword);
  if (hasWebsite && matchesBusiness && hasContactSignal(lead)) return 'A';
  if (hasWebsite && matchesBusiness) return 'B';
  if (hasWebsite) return 'C';
  return 'D';
}

function gradeRank(grade) {
  return { A: 4, B: 3, C: 2, D: 1 }[grade] || 0;
}

function calculateAIRecommendationScore(lead, industry = '', keyword = '') {
  const urlText = `${lead.website || ''} ${lead.company || ''}`.toLowerCase();
  const businessText = `${lead.product || ''} ${lead.summary || ''}`.toLowerCase();
  const identityTopicTerms = getTopicTerms(industry);
  const identityMatchesTopic = identityTopicTerms.some((term) => textContainsTerm(urlText, term));
  let score = Math.round((lead.companyScore ?? calculateCompanyScore(lead, industry, keyword)) * 0.7)
    + Math.round((lead.contactCompletenessScore ?? calculateContactCompletenessScore(lead)) * 0.3);
  const countryFitScore = lead.countryFitScore ?? 60;

  if (countryFitScore <= 20) score -= 35;
  else if (countryFitScore < 50) score -= 15;
  if ((lead.industryMatchScore || 0) < 30) score -= 45;
  if (/official|seed|google|bing|duckduckgo/i.test(lead.source || '')) score += 2;
  if (lead.source !== 'Official Website Seed' && identityTopicTerms.length > 0 && !identityMatchesTopic) score -= 35;
  if (/directory|list|top|news|blog|article|wiki|travel|tourism/i.test(`${urlText} ${businessText}`)) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function buildAIRecommendationReason(lead, industry = '', keyword = '') {
  const reasons = [];
  const businessText = `${lead.product || ''} ${lead.summary || ''}`.toLowerCase();
  if (lead.website && isRealCompanyWebsite(lead.website)) reasons.push('官网真实');
  if ((lead.countryFitScore ?? 60) >= 80) reasons.push('国家匹配');
  if ((lead.industryMatchScore || 0) >= 70 || businessMatchesTopic(lead, industry, keyword)) reasons.push('主营业务匹配');
  if (lead.product) reasons.push('主营产品已识别');
  if (lead.email && (lead.phone || lead.whatsapp)) reasons.push('联系方式完整');
  else if (lead.email || lead.phone || lead.whatsapp) reasons.push('已有公开联系方式');
  if (/\b(?:export|exporter|global|international|worldwide|overseas)\b/i.test(businessText)) reasons.push('具备出口/国际业务信号');
  if (/\b(?:oem|odm|private label|custom|factory|manufacturer)\b/i.test(`${lead.company || ''} ${businessText}`)) reasons.push('具备OEM/制造能力信号');
  if (lead.linkedin) reasons.push('LinkedIn可验证');
  if (lead.foundedYear || lead.employeeSize || lead.address || lead.city) reasons.push('公司规模或地址信息可验证');
  return `${reasons.join('，') || '官网可验证，具备潜在开发价值'}。建议今天优先联系。`;
}

function withLeadGrade(lead, industry = '', keyword = '') {
  const matchedTopic = (lead.industryMatchScore || 0) >= 50 || businessMatchesTopic(lead, industry, keyword);
  const product = matchedTopic
    ? (lead.product || inferBusinessProfile(`${industry} ${keyword}`, `${industry} ${keyword}`))
    : lead.product;
  const enrichedLead = {
    ...lead,
    product,
    industryMatchScore: lead.industryMatchScore || calculateIndustryMatchScore({ url: lead.website, company: lead.company, text: `${lead.product || ''} ${lead.summary || ''}` }, industry, keyword),
    countryFitScore: lead.countryFitScore ?? calculateCountryFitScore({ url: lead.website, company: lead.company, text: `${lead.product || ''} ${lead.summary || ''}` }, lead.country),
  };
  enrichedLead.companyScore = lead.companyScore ?? calculateCompanyScore(enrichedLead, industry, keyword);
  enrichedLead.contactCompletenessScore = lead.contactCompletenessScore ?? calculateContactCompletenessScore(enrichedLead);
  return {
    ...enrichedLead,
    grade: gradeLead(enrichedLead, industry, keyword),
    aiRecommendationScore: calculateAIRecommendationScore(enrichedLead, industry, keyword),
    recommendation: buildAIRecommendationReason(enrichedLead, industry, keyword),
  };
}

export function buildRealLead({ company, website, country, city = '', email = '', phone = '', whatsapp = '', product = '', summary = '', source = '', sourceUrl = '', contact = '', contactTitle = '', linkedin = '', facebook = '', instagram = '', googleMaps = '', address = '', foundedYear = '', employeeSize = '' }) {
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
    contactTitle: normalizeText(contactTitle || extractContactTitle(summary || '')),
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
    const product = extractBusiness(text, industry);
    const summary = buildCompanySummary(companyName, product, country || extractCountry(text));
    const industryMatchScore = candidate.source === 'Official Website Seed'
      ? Math.max(90, calculateIndustryMatchScore({ url: candidate.url, company: companyName, text }, industry, keyword))
      : calculateIndustryMatchScore({ url: candidate.url, company: companyName, text }, industry, keyword);
    const countryFitScore = candidate.source === 'Official Website Seed'
      ? Math.max(100, calculateCountryFitScore({ url: candidate.url, company: companyName, text }, country))
      : calculateCountryFitScore({ url: candidate.url, company: companyName, text }, country);
    const sitePages = await crawlCompanySite(cleanUrl(candidate.url));
    let signals = await discoverContactSignals({
      company: companyName,
      website: cleanUrl(candidate.url),
      country,
      sitePages,
      fallbackText: `${text}\n${$$.root().html()}`,
    });
    let lead = {
      ...buildRealLead({
      company: companyName,
      website: cleanUrl(candidate.url),
      country,
      city,
      email: signals.email || extractEmail(text),
      phone: signals.phone || extractPhone(text),
      whatsapp: signals.whatsapp || extractWhatsApp(text),
      product,
      summary,
      industryMatchScore,
      countryFitScore,
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
      contactTitle: signals.contactTitle || extractContactTitle(text),
      }),
      industryMatchScore,
      countryFitScore,
    };
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
      !['not-real-company-website', 'blocked-path', 'file-url', 'non-enterprise-identity', 'non-company-content', 'recruiting-page', 'missing-enterprise-signal'].includes(identity.reason)
    ) {
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
  const normalizedIndustry = normalizeText(`${industry} ${normalizeIndustryForSearch(industry)}`).toLowerCase();
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

  if (normalizedIndustry.includes('jewelry') || normalizedIndustry.includes('jewellery') || normalizedIndustry.includes('bracelet') || normalizedIndustry.includes('earring') || normalizedIndustry.includes('accessor') || /珠宝|首饰|饰品|耳钉|耳环|手镯|手链|项链|戒指/.test(normalizedIndustry)) {
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
        ['https://www.hooverandstrong.com', 'Hoover & Strong'],
        ['https://www.riogrande.com', 'Rio Grande'],
        ['https://www.firemountaingems.com', 'Fire Mountain Gems'],
        ['https://www.jewelrydesigns.com', 'Jewelry Designs'],
        ['https://www.gesswein.com', 'Gesswein'],
      );
    } else if (normalizedCountry.includes('united kingdom') || normalizedCountry === 'uk') {
      seeds.push(
        ['https://centrejewellery.com', 'Centre Jewellery'],
        ['https://www.nf1-jewellery.co.uk', 'NF1 Jewellery'],
        ['https://jewellerytradingcompany.com', 'Jewellery Trading Company'],
        ['https://www.dbmjewellery.com', 'DBM Jewellery'],
        ['https://www.cmejewellery.com', 'CME Jewellery'],
        ['https://www.dowerandhall.com', 'Dower & Hall'],
        ['https://www.pom925.com', 'POM Jewellery'],
        ['https://www.cooksongold.com', 'Cooksongold'],
        ['https://www.dominojewellery.com', 'Domino Jewellery'],
        ['https://www.westonbeamor.com', 'Weston Beamor'],
      );
    }
  }

  if (normalizedIndustry.includes('furniture')) {
    if (normalizedCountry.includes('vietnam')) {
      seeds.push(
        ['https://www.aa-corporation.com', 'AA Corporation'],
        ['https://www.scansia.com', 'Scansia Pacific'],
        ['https://www.kaiser1.com', 'Kaiser 1 Furniture'],
        ['https://woodsland.com.vn', 'Woodsland'],
        ['https://ducthanh.com', 'Duc Thanh Wood Processing'],
        ['https://truongthanh.com', 'Truong Thanh Furniture'],
        ['https://www.minhduongf.com', 'Minh Duong Furniture'],
        ['https://www.rochdalespears.com', 'Rochdale Spears'],
        ['https://www.savimex.com', 'Savimex'],
        ['https://nhaxinh.com', 'Nha Xinh'],
        ['https://www.hoaphat.com.vn', 'Hoa Phat Furniture'],
        ['https://www.meetco-furniture.com', 'Meet&Co Office Furniture'],
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
        ['https://www.elring.com', 'Elring'],
        ['https://www.hengst.com', 'Hengst Filtration'],
        ['https://www.ms-motorservice.com', 'MS Motorservice'],
        ['https://www.trwaftermarket.com', 'TRW Aftermarket'],
        ['https://www.optimal-germany.com', 'OPTIMAL Germany'],
        ['https://www.metzger-autoteile.de', 'METZGER Autoteile'],
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
  return withLeadGrade({
    ...buildRealLead({
    company: candidate.company,
    website: cleanUrl(candidate.url),
    country,
    product,
    summary: buildCompanySummary(candidate.company, product, country),
    source: 'Official Website Seed',
    sourceUrl: '',
    }),
    industryMatchScore: 90,
    countryFitScore: 100,
  }, industry, keyword);
}

async function runContactDiscoverySearch(company, website, country) {
  const domain = (() => {
    try {
      return new URL(website).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const queries = [
    `${company} ${country} email`,
    `${company} contact`,
    `${company} sales`,
    `${company} purchasing`,
    `${company} export`,
    `${company} LinkedIn`,
    `${company} Hunter`,
    `${company} Apollo`,
    `${company} RocketReach`,
    `${company} Crunchbase`,
    `${company} WhatsApp`,
    domain ? `${domain} email contact` : '',
  ].filter(Boolean);
  const pages = [];

  for (const query of queries.slice(0, 10)) {
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

async function discoverContactSignals({ company, website, country, sitePages = [], fallbackText = '' }) {
  const siteSignals = collectCompanySignals([
    ...sitePages,
    fallbackText ? { url: website, text: fallbackText } : null,
  ].filter(Boolean));
  const needsMore = !siteSignals.email || (!siteSignals.phone && !siteSignals.whatsapp) || !siteSignals.linkedin || !siteSignals.contact;
  const publicSignals = needsMore
    ? await runContactDiscoverySearch(company, website, country)
    : {};

  return {
    email: siteSignals.email || publicSignals.email || '',
    phone: siteSignals.phone || publicSignals.phone || '',
    whatsapp: siteSignals.whatsapp || publicSignals.whatsapp || '',
    contact: siteSignals.contact || publicSignals.contact || '',
    contactTitle: siteSignals.contactTitle || publicSignals.contactTitle || '',
    linkedin: siteSignals.linkedin || publicSignals.linkedin || '',
    facebook: siteSignals.facebook || publicSignals.facebook || '',
    instagram: siteSignals.instagram || publicSignals.instagram || '',
    googleMaps: siteSignals.googleMaps || publicSignals.googleMaps || '',
    address: siteSignals.address || publicSignals.address || '',
  };
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
    if (/^(www\.)?google\.[a-z.]+$/i.test(host)) return true;
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
  const { country, industry, keyword = '' } = req.body;
  if (!country || !industry) {
    return res.status(400).json({ error: 'country and industry are required' });
  }

  try {
    const searchCountry = normalizeCountryForSearch(country);
    const searchIndustry = normalizeIndustryForSearch(industry);
    const searchKeyword = `${searchCountry} ${searchIndustry}`;
    const expandedQueries = buildSearchQueries({ country, industry });
    console.info('[search debug] request', {
      country,
      industry,
      keyword,
      normalizedCountry: searchCountry,
      normalizedIndustry: searchIndustry,
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
    const officialCandidates = selectOfficialCandidates(uniqueCandidates, BUILD_CANDIDATE_LIMIT, searchIndustry);
    const rawCompanies = dedupeLeadsByWebsite((await Promise.all(officialCandidates.map(async (candidate) => {
      const lead = await buildLeadFromSearchCandidate(candidate, country, searchIndustry, '', true);
      if (lead) return lead;
      if (candidate.source === 'Official Website Seed') {
        return buildLeadFromOfficialSeed(candidate, country, searchIndustry, '');
      }
      return null;
    }))).filter(Boolean));
    const companies = rawCompanies
      .map((lead) => withLeadGrade(lead, searchIndustry, ''))
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
