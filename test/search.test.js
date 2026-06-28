import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const {
  normalizeText,
  extractEmail,
  extractPhone,
  extractWebsite,
  buildSearchQueries,
  extractBusiness,
  buildLeadFromCandidate,
  shouldKeepCandidate,
  identifyEnterpriseCandidate,
  buildCompanySummary,
  buildOutreachBundle,
  buildRealLead,
  dedupeCandidates,
  selectOfficialCandidates,
  extractCity,
  extractFoundedYear,
  extractEmployeeCount,
  extractSocialLinks,
  collectCompanySignals,
  calculateIndustryMatchScore,
  calculateCountryFitScore,
  calculateCompanyScore,
  calculateContactCompletenessScore,
  normalizeIndustryForSearch,
  INDUSTRY_KEYWORD_LIBRARY,
} = await import('../server.js');

test('normalizeText trims whitespace and collapses spaces', () => {
  assert.equal(normalizeText('  Hello   world  '), 'Hello world');
});

test('extractEmail finds email in text', () => {
  assert.equal(extractEmail('Contact us at sales@example.com'), 'sales@example.com');
});

test('extractPhone finds phone number', () => {
  assert.equal(extractPhone('Call us at +1 415 555 0148'), '+1 415 555 0148');
});

test('extractWebsite finds website', () => {
  assert.equal(extractWebsite('Visit https://example.com now'), 'https://example.com');
});

test('buildSearchQueries expands country and industry without user keywords', () => {
  const queries = buildSearchQueries({ country: '美国', industry: 'LED' });
  assert.equal(queries.length, 20);
  assert.ok(queries.includes('United States LED manufacturer'));
  assert.ok(queries.includes('United States Commercial lighting'));
  assert.ok(queries.every((query) => !query.includes('undefined')));
});

test('Chinese jewelry product inputs are translated to broad jewelry searches', () => {
  assert.equal(normalizeIndustryForSearch('珠宝首饰'), 'Jewelry');
  assert.equal(normalizeIndustryForSearch('耳钉'), 'Jewelry');

  const queries = buildSearchQueries({ country: '英国', industry: '耳钉' });
  assert.equal(queries.length, 20);
  assert.ok(queries.includes('United Kingdom Jewelry manufacturer'));
  assert.ok(queries.includes('United Kingdom Jewellery supplier'));
  assert.ok(queries.includes('United Kingdom OEM jewelry'));
  assert.ok(queries.every((query) => !/earrings|stud earrings|bracelet|necklace|ring/i.test(query)));
});

test('industry keyword library is fixed for V1.2 search categories', () => {
  ['Jewelry', 'LED Lighting', 'Furniture', 'Auto Parts', 'Packaging', 'Cosmetics'].forEach((industry) => {
    assert.equal(INDUSTRY_KEYWORD_LIBRARY[industry].length, 20, industry);
  });

  assert.deepEqual(buildSearchQueries({ country: 'Vietnam', industry: 'Furniture' }).slice(0, 3), [
    'Vietnam Furniture manufacturer',
    'Vietnam Furniture supplier',
    'Vietnam Furniture exporter',
  ]);
  assert.ok(buildSearchQueries({ country: 'Germany', industry: 'Auto Parts' }).includes('Germany OEM Auto Parts'));
  assert.ok(buildSearchQueries({ country: 'Japan', industry: 'Cosmetics' }).includes('Japan Skincare manufacturer'));
});

test('extractBusiness extracts a concise business summary', () => {
  const business = extractBusiness('We design and manufacture energy efficient LED lighting systems for commercial projects');
  assert.match(business.toLowerCase(), /led|lighting|manufacture/);
  assert.ok(extractBusiness(`${'LED products '.repeat(40)} manufacturer`).length <= 220);
});

test('extractBusiness and outreach copy ignore website navigation and SEO garbage', () => {
  const noisy = 'FOREIGN INVESTORS National flag Vietnamese Declaration Skip to content Home Products Catalog Request a Quote Privacy Policy SEO text LED lighting manufacturer for warehouses and commercial buildings';
  const business = extractBusiness(noisy, 'LED Lighting');
  const summary = buildCompanySummary('Clean LED Co.', noisy, 'United States');
  const bundle = buildOutreachBundle({
    company: 'Clean LED Co.',
    country: 'United States',
    product: noisy,
    summary,
  });
  const combined = `${business} ${summary} ${bundle.email} ${bundle.whatsapp} ${bundle.linkedin} ${bundle.followup2}`;

  assert.match(business.toLowerCase(), /led lighting|lighting solutions|fixtures/);
  assert.doesNotMatch(combined, /FOREIGN INVESTORS|National flag|Vietnamese|Declaration|Skip to content|Privacy Policy|SEO text/i);
});

test('buildLeadFromCandidate preserves source information and never marks demo data', () => {
  const lead = buildLeadFromCandidate({
    company: 'Example Jewelry Co.',
    website: 'https://example.com',
    email: 'info@example.com',
    phone: '+1 555 010 0000',
    country: 'United States',
    source: 'google-search',
    sourceUrl: 'https://www.google.com/search?q=United+States+Fashion+Jewelry',
  });

  assert.equal(lead.company, 'Example Jewelry Co.');
  assert.equal(lead.website, 'https://example.com');
  assert.equal(lead.source, 'google-search');
  assert.equal(lead.sourceUrl, 'https://www.google.com/search?q=United+States+Fashion+Jewelry');
  assert.equal(lead.demo, undefined);
});

test('buildLeadFromCandidate leaves missing email and phone empty', () => {
  const lead = buildLeadFromCandidate({
    company: 'Hidden Corp',
    website: 'https://hidden.example',
    country: 'United States',
    source: 'bing',
    sourceUrl: 'https://www.bing.com/search?q=United+States+Fashion+Jewelry',
  });

  assert.equal(lead.email, '');
  assert.equal(lead.phone, '');
});

test('extractEmail and extractPhone reject noisy text fragments', () => {
  const email = extractEmail('Contact us at bruce_hou_ootbjewelry@outlook.comHead or sales@example.com');
  const labeledEmail = extractEmail('Emailinfo@example.com');
  const phone = extractPhone('Call us at 2026 for support or +1 212 555 0199');
  const dateLikePhone = extractPhone('Updated 2026-06-27 13');
  const decimalLikePhone = extractPhone('Grid ratio 1.8571428571429');
  const yearRange = extractPhone('Strategic plan 2026-2030');

  assert.equal(email, 'sales@example.com');
  assert.equal(labeledEmail, 'info@example.com');
  assert.equal(phone, '+1 212 555 0199');
  assert.equal(dateLikePhone, '');
  assert.equal(decimalLikePhone, '');
  assert.equal(yearRange, '');
});

test('shouldKeepCandidate rejects news, careers and non-company pages while keeping manufacturer sites', () => {
  assert.equal(
    shouldKeepCandidate({
      url: 'https://example.com/news/2024/fashion-jewelry',
      text: 'Latest news about fashion jewelry trends',
      company: 'Example News',
    }),
    false,
  );

  assert.equal(
    shouldKeepCandidate({
      url: 'https://example.com/careers/engineer',
      text: 'Join our engineering team',
      company: 'Example Careers',
    }),
    false,
  );

  assert.equal(
    shouldKeepCandidate({
      url: 'https://baike.baidu.com/item/led',
      text: '百度百科 LED 词条',
      company: '百度百科',
    }),
    false,
  );

  assert.equal(
    shouldKeepCandidate({
      url: 'https://example.com/led-list',
      text: '美国前 30 名 LED 灯带制造商和供应商',
      company: 'LED 排行榜',
    }),
    false,
  );

  assert.equal(
    shouldKeepCandidate({
      url: 'https://www.kayak.com/travel',
      text: 'Passengers with disabilities and travel services in the United States',
      company: 'KAYAK',
      topic: 'LED',
    }),
    false,
  );

  assert.equal(
    shouldKeepCandidate({
      url: 'https://www.examplefactory.com',
      text: 'We are a leading manufacturer and supplier of fashion jewelry',
      company: 'Example Factory',
    }),
    true,
  );
});

test('identifyEnterpriseCandidate keeps only enterprise websites that match the requested business', () => {
  const topic = 'Vietnam Jewelry Bracelet';
  const rejected = [
    {
      url: 'https://moit.gov.vn/jewelry-export-policy',
      company: 'Vietnam Ministry of Industry and Trade',
      text: 'Government ministry policy article about jewelry exports and trade regulations.',
    },
    {
      url: 'https://vietnamjewelryassociation.org.vn/bracelet-members',
      company: 'Vietnam Jewelry Association',
      text: 'Association news and member directory for the jewelry industry.',
    },
    {
      url: 'https://news.example.com/vietnam-jewelry-bracelet-trends',
      company: 'Example News',
      text: 'News article about bracelet trends in Vietnam.',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Jewellery',
      company: 'Wikipedia',
      text: 'Wikipedia article about jewellery.',
    },
    {
      url: 'https://travel.example.com/vietnam-jewelry-shopping',
      company: 'Vietnam Travel Guide',
      text: 'Tourism guide for shopping bracelets and souvenirs.',
    },
    {
      url: 'https://forum.example.com/vietnam-bracelet-suppliers',
      company: 'Jewelry Forum',
      text: 'Forum discussion about where to buy bracelets.',
    },
    {
      url: 'https://facebook.com/posts/123',
      company: 'Facebook Post',
      text: 'Facebook article about jewelry.',
    },
    {
      url: 'https://personalblog.example.com/vietnam-bracelet-story',
      company: 'Personal Blog',
      text: 'Blog story about Vietnamese bracelet shopping.',
    },
  ];

  rejected.forEach((candidate) => {
    assert.equal(identifyEnterpriseCandidate({ ...candidate, country: 'Vietnam', topic }).keep, false, candidate.url);
  });

  const kept = identifyEnterpriseCandidate({
    url: 'https://saigonbraceletfactory.com',
    company: 'Saigon Bracelet Factory Co., Ltd',
    text: 'We are a Vietnam jewelry manufacturer, bracelet factory, OEM supplier and exporter producing silver bracelets, fashion jewelry and custom accessories for global buyers.',
    country: 'Vietnam',
    topic,
  });

  assert.equal(kept.keep, true);

  assert.equal(identifyEnterpriseCandidate({
    url: 'https://sparklejewellers.com.bd',
    company: 'Sparkle Jewellers',
    text: 'Bangladesh jewelry retailer with bracelet collections and +880 phone number.',
    country: 'Vietnam',
    topic,
  }).keep, false);

  assert.equal(identifyEnterpriseCandidate({
    url: 'https://www.psdaima.com/top-leather-bracelet-manufacturers-in-vietnam',
    company: 'Top Leather Bracelet Manufacturers in Vietnam',
    text: 'Top leather bracelet manufacturers in Vietnam article and buying guide.',
    country: 'Vietnam',
    topic,
  }).keep, false);
});

test('calculateIndustryMatchScore requires strong jewelry relevance before recommendation', () => {
  assert.ok(calculateIndustryMatchScore({
    url: 'https://examplejewellery.co.uk',
    company: 'Example Jewellery Manufacturer',
    text: 'Wholesale jewellery supplier producing stud earrings, silver jewelry, bracelets, necklaces and rings for retailers.',
  }, '珠宝首饰', '耳钉') >= 60);

  assert.ok(calculateIndustryMatchScore({
    url: 'https://datasciencepartners.co.uk',
    company: 'Data Science Partners',
    text: 'Software, data science consulting, analytics and IT service for enterprise teams.',
  }, '珠宝首饰', '耳钉') < 60);

  assert.ok(calculateIndustryMatchScore({
    url: 'https://xbox.com',
    company: 'Xbox',
    text: 'Gaming consoles, Xbox software subscriptions and entertainment.',
  }, 'jewellery', 'earrings') < 60);
});

test('calculateCountryFitScore penalizes companies from the wrong country', () => {
  assert.equal(calculateCountryFitScore({
    url: 'https://www.essentials-jewelry.com',
    company: 'Custom Jewelry Manufacturer - Jewellery Manufacturer in India',
    text: 'Jewellery manufacturer based in Jaipur India with +91 phone number.',
  }, 'United States'), 0);

  assert.equal(calculateCountryFitScore({
    url: 'https://www.nf1-jewellery.co.uk',
    company: 'NF1 Jewellery',
    text: 'Wholesale jewellery manufacturer in the United Kingdom. Call +44 20 0000 0000.',
  }, 'United Kingdom'), 100);
});

test('extractSocialLinks picks up LinkedIn, Facebook and Google Maps URLs', () => {
  const links = extractSocialLinks('Visit https://www.linkedin.com/company/example-factory and https://www.facebook.com/examplefactory and https://www.google.com/maps/place/Example+Factory');
  assert.equal(links.linkedin, 'https://www.linkedin.com/company/example-factory');
  assert.equal(links.facebook, 'https://www.facebook.com/examplefactory');
  assert.equal(links.googleMaps, 'https://www.google.com/maps/place/Example+Factory');
});

test('collectCompanySignals merges data from contact, about and privacy pages', () => {
  const signals = collectCompanySignals([
    {
      url: 'https://examplefactory.com/contact',
      text: 'Contact us at sales@examplefactory.com or call +1 555 010 0000. WhatsApp +1 555 010 0001. Jane Doe Sales Manager.',
    },
    {
      url: 'https://examplefactory.com/about',
      text: 'Meet Jane Doe, founder. https://www.linkedin.com/company/example-factory',
    },
    {
      url: 'https://examplefactory.com/privacy',
      text: 'Follow us on https://www.facebook.com/examplefactory and https://www.google.com/maps/place/Example+Factory',
    },
  ]);

  assert.equal(signals.email, 'sales@examplefactory.com');
  assert.equal(signals.phone, '+1 555 010 0000');
  assert.equal(signals.whatsapp, '+1 555 010 0001');
  assert.equal(signals.contact, 'Jane Doe');
  assert.equal(signals.contactTitle, 'Sales Manager');
  assert.equal(signals.linkedin, 'https://www.linkedin.com/company/example-factory');
  assert.equal(signals.facebook, 'https://www.facebook.com/examplefactory');
  assert.equal(signals.googleMaps, 'https://www.google.com/maps/place/Example+Factory');
});

test('company score and contact completeness are separated', () => {
  const companyOnly = buildRealLead({
    company: 'Example Furniture Factory',
    website: 'https://examplefurniture.vn',
    country: 'Vietnam',
    product: 'furniture manufacturer and exporter',
    summary: 'OEM furniture factory producing wood furniture for export buyers.',
  });
  const withContact = buildRealLead({
    ...companyOnly,
    email: 'sales@examplefurniture.vn',
    linkedin: 'https://www.linkedin.com/company/example-furniture',
    contact: 'Jane Doe',
    contactTitle: 'Export Manager',
  });

  assert.ok(calculateCompanyScore({ ...companyOnly, industryMatchScore: 90, countryFitScore: 100 }, 'Furniture') >= 70);
  assert.equal(calculateContactCompletenessScore(companyOnly), 0);
  assert.ok(calculateContactCompletenessScore(withContact) >= 50);
});

test('dedupeCandidates merges repeated website domains and keeps the strongest source first', () => {
  const unique = dedupeCandidates([
    { url: 'https://examplefactory.com', company: 'Example Factory', source: 'Google Search', sourceUrl: 'https://example.com/search' },
    { url: 'https://examplefactory.com/', company: 'Example Factory', source: 'Google Maps', sourceUrl: 'https://example.com/maps' },
    { url: 'https://examplefactory.com/contact', company: 'Example Factory', source: 'LinkedIn', sourceUrl: 'https://linkedin.com' },
  ]);

  assert.equal(unique.length, 1);
  assert.equal(unique[0].source, 'Google Search');
});

test('selectOfficialCandidates keeps trusted official seeds ahead of noisy search results', () => {
  const noisyResults = Array.from({ length: 20 }, (_, index) => ({
    url: `https://search-result-${index}.example.com/products/led-lighting`,
    company: `Search Result ${index}`,
    source: 'Bing',
  }));
  const selected = selectOfficialCandidates([
    ...noisyResults,
    {
      url: 'https://usled.com',
      company: 'US LED',
      source: 'Official Website Seed',
    },
  ]);

  assert.equal(selected[0].url, 'https://usled.com');
  assert.ok(selected.some((candidate) => candidate.url === 'https://usled.com'));
  assert.equal(selected.length, 12);
});

test('extractCity, extractFoundedYear and extractEmployeeCount parse public company metadata', () => {
  const text = 'Founded in 1998. Headquartered in Dallas, Texas, USA. 120 employees worldwide.';
  assert.equal(extractCity(text), 'Dallas');
  assert.equal(extractFoundedYear(text), '1998');
  assert.equal(extractEmployeeCount(text), '120 employees');
  assert.equal(extractFoundedYear('Copyright 2026 Example Factory'), '2026');
});

test('buildRealLead returns real enrichment fields and a purchase score', () => {
  const lead = buildRealLead({
    company: 'Example Factory',
    website: 'https://examplefactory.com',
    country: 'United States',
    city: 'Dallas',
    email: 'sales@examplefactory.com',
    phone: '+1 555 010 0000',
    whatsapp: '+1 555 010 0001',
    product: 'fashion jewelry manufacturing',
    summary: 'Example Factory manufactures fashion jewelry and serves global retailers.',
    source: 'Google Search',
    sourceUrl: 'https://www.google.com/search?q=examplefactory',
    linkedin: 'https://www.linkedin.com/company/example-factory',
    facebook: 'https://www.facebook.com/examplefactory',
    googleMaps: 'https://www.google.com/maps/place/Example+Factory',
    foundedYear: '1998',
    employeeSize: '120 employees',
  });

  assert.equal(lead.company, 'Example Factory');
  assert.equal(lead.email, 'sales@examplefactory.com');
  assert.equal(lead.phone, '+1 555 010 0000');
  assert.equal(lead.city, 'Dallas');
  assert.equal(lead.linkedin, 'https://www.linkedin.com/company/example-factory');
  assert.equal(lead.score, 5);
});

test('buildCompanySummary and buildOutreachBundle use real company information', () => {
  const summary = buildCompanySummary('Example Factory', 'We manufacture premium fashion jewelry and wholesale accessories for global retailers.', 'United States');
  const bundle = buildOutreachBundle({
    company: 'Example Factory',
    country: 'United States',
    product: 'premium fashion jewelry',
    summary,
  });

  assert.match(summary.toLowerCase(), /manufacturer|fashion|jewelry|wholesale/);
  assert.ok(bundle.subject.includes('Example Factory'));
  assert.ok(bundle.email.split(/\s+/).length >= 90 && bundle.email.split(/\s+/).length <= 180);
  assert.ok(bundle.whatsapp.split(/\s+/).length <= 80);
  assert.ok(bundle.linkedin.length > 20);
  assert.ok(bundle.followup2.length > 40);
});
