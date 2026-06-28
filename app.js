const state = {
  leads: [],
  selectedLead: null,
  generatedBundle: null,
  enrichedLeads: [],
  searchMeta: null,
  loadingTimer: null,
  currentSearch: { country: '', industry: '', keyword: '' },
  crmFilter: { country: '', industry: '' },
};

function setStatus(message) {
  document.getElementById('statusPill').textContent = message;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function getStars(score) {
  const full = '★'.repeat(score);
  const empty = '☆'.repeat(5 - score);
  return `${full}${empty}`;
}

function getLeadPriority(score = 3) {
  if (score >= 5) {
    return { label: '高优先客户', className: 'priority-high' };
  }
  if (score >= 4) {
    return { label: '推荐开发', className: 'priority-recommended' };
  }
  return { label: '普通客户', className: 'priority-normal' };
}

function getLeadGrade(lead) {
  return lead.grade || 'D';
}

function getGradeClass(grade) {
  return `grade-${String(grade || 'D').toLowerCase()}`;
}

function gradeRank(grade) {
  return { A: 4, B: 3, C: 2, D: 1 }[grade] || 0;
}

function formatElapsed(ms) {
  if (!ms && ms !== 0) return '—';
  return `${(ms / 1000).toFixed(1)} 秒`;
}

function formatScore(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
}

function isSearchDebugMode() {
  return new URLSearchParams(window.location.search).get('debug') === '1' || localStorage.getItem('globallead-debug') === '1';
}

function getSourceCounts(leads) {
  return leads.reduce((counts, lead) => {
    const source = String(lead.source || '').toLowerCase();
    if (source.includes('google')) counts.google += 1;
    if (source.includes('bing')) counts.bing += 1;
    if (source.includes('duck')) counts.duckDuckGo += 1;
    return counts;
  }, { google: 0, bing: 0, duckDuckGo: 0 });
}

function renderSearchSummary(meta) {
  const summary = document.getElementById('searchSummary');
  if (!summary) return;
  if (!meta) {
    summary.hidden = true;
    summary.innerHTML = '';
    return;
  }
  const counts = meta.engineCounts || {};
  const gradeCounts = meta.gradeCounts || {};
  const keywords = meta.expandedQueries || [];
  const debug = isSearchDebugMode();
  summary.hidden = false;
  summary.innerHTML = `
    <div class="summary-metric"><span>国家</span><strong>${escapeHtml(meta.country || '—')}</strong></div>
    <div class="summary-metric"><span>行业</span><strong>${escapeHtml(meta.industry || meta.keyword || '—')}</strong></div>
    <div class="summary-metric"><span>AI推荐</span><strong>${escapeHtml(meta.total || 0)} 家最值得开发客户</strong></div>
    <div class="summary-metric"><span>耗时</span><strong>${escapeHtml(formatElapsed(meta.elapsedMs))}</strong></div>
    ${debug ? `
    <div class="summary-metric"><span>搜索源返回总数</span><strong>${escapeHtml(meta.sourceReturnedTotal || 0)}</strong></div>
    <div class="summary-metric"><span>AI评分企业数</span><strong>${escapeHtml(meta.scoredCandidateCount || meta.total || 0)}</strong></div>
    <div class="summary-metric"><span>重复删除数量</span><strong>${escapeHtml(meta.duplicateRemovedCount || 0)}</strong></div>
    <div class="summary-metric"><span>客户等级</span><strong>A ${gradeCounts.A || 0} / B ${gradeCounts.B || 0} / C ${gradeCounts.C || 0} / D ${gradeCounts.D || 0}</strong></div>
    <div class="summary-sources">
      <span>搜索来源</span>
      <div>
        <b>Google</b><em>${counts.google || 0}</em>
        <b>Bing</b><em>${counts.bing || 0}</em>
        <b>DuckDuckGo</b><em>${counts.duckDuckGo || 0}</em>
      </div>
    </div>
    <div class="summary-keywords">
      <span>AI扩展搜索词</span>
      <p>${escapeHtml(keywords.slice(0, 10).join(' / ') || meta.keyword || '—')}</p>
    </div>
    ` : `
    <div class="summary-metric wide"><span>AI已分析</span><strong>${escapeHtml(meta.sourceReturnedTotal || meta.scoredCandidateCount || meta.total || 0)} 家企业，已按推荐指数排序</strong></div>
    `}
  `;
}

function setLoadingStep(index) {
  ['loadingStepAnalyze', 'loadingStepContact', 'loadingStepCrm'].forEach((id, stepIndex) => {
    const node = document.getElementById(id);
    if (node) node.classList.toggle('active', stepIndex <= index);
  });
}

function showSearchLoading() {
  const loading = document.getElementById('searchLoading');
  if (!loading) return;
  loading.hidden = false;
  setLoadingStep(0);
  let step = 0;
  clearInterval(state.loadingTimer);
  state.loadingTimer = setInterval(() => {
    step = Math.min(step + 1, 2);
    setLoadingStep(step);
  }, 1200);
}

function hideSearchLoading() {
  clearInterval(state.loadingTimer);
  state.loadingTimer = null;
  const loading = document.getElementById('searchLoading');
  if (loading) loading.hidden = true;
}

function scoreLead(lead) {
  let score = 2;
  if (lead.email) score += 1;
  if (lead.phone) score += 1;
  if (lead.website) score += 1;
  if (lead.product) score += 1;
  if (lead.city) score += 1;
  if (lead.foundedYear || lead.employeeSize) score += 1;
  if (lead.linkedin || lead.facebook || lead.googleMaps) score += 1;
  return Math.min(5, score);
}

function buildRecommendation(lead) {
  const reasons = [];
  if (lead.email) reasons.push('已确认邮箱');
  if (lead.phone) reasons.push('已确认电话');
  if (lead.website) reasons.push('有官网可进一步验证');
  if (lead.product) reasons.push('主营业务已识别');
  if (lead.city) reasons.push('已确认城市');
  if (lead.foundedYear || lead.employeeSize) reasons.push('已确认公司规模信息');
  if (lead.linkedin || lead.facebook || lead.googleMaps) reasons.push('已找到公开社交/地图信息');
  return `推荐原因：${reasons.join('，') || '具备潜在合作价值'}`;
}

function buildPurchaseAdvice(lead) {
  const advice = [];
  if (lead.email || lead.phone || lead.whatsapp) advice.push('优先使用已识别的直接联系方式进行第一轮触达。');
  if (lead.website) advice.push('沟通前复核官网产品线，选择与其主营业务贴近的切入点。');
  if (lead.linkedin || lead.facebook || lead.googleMaps) advice.push('可通过公开社交或地图信息交叉验证公司活跃度。');
  if (lead.score >= 5) advice.push('建议列入本周重点开发名单，并安排二次跟进。');
  return advice.join(' ') || '建议先验证官网与联系人，再进行轻量外联测试。';
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getCRMLeads() {
  const crm = JSON.parse(localStorage.getItem('lead-crm') || '[]');
  return crm.map((lead) => {
    const score = lead.score || scoreLead(lead);
    return {
      ...lead,
      country: lead.country || lead.crmCountry || '',
      industry: lead.industry || lead.searchIndustry || '',
      grade: lead.grade || 'D',
      aiRecommendationScore: lead.aiRecommendationScore || 0,
      score,
      recommendation: lead.recommendation || buildRecommendation({ ...lead, score }),
    };
  });
}

function saveCRMLeads(leads) {
  localStorage.setItem('lead-crm', JSON.stringify(leads));
}

function getLeadKey(lead) {
  const website = normalizeText(lead.website).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  if (website) return `site:${website}`;
  return `company:${normalizeText(lead.company)}:${normalizeText(lead.country || lead.crmCountry)}`;
}

function decorateLeadForCRM(lead) {
  const score = lead.score || scoreLead(lead);
  return {
    ...lead,
    country: lead.country || state.currentSearch.country || '',
    industry: lead.industry || state.currentSearch.industry || '',
    searchKeyword: lead.searchKeyword || state.currentSearch.keyword || '',
    grade: lead.grade || getLeadGrade(lead),
    aiRecommendationScore: lead.aiRecommendationScore || 0,
    score,
    recommendation: lead.recommendation || buildRecommendation({ ...lead, score }),
    addedAt: lead.addedAt || new Date().toISOString(),
  };
}

function isLeadInCRM(lead) {
  const key = getLeadKey(lead);
  return getCRMLeads().some((item) => getLeadKey(item) === key);
}

function crmMatchesCurrentFilter(lead) {
  const filter = state.crmFilter || {};
  const industry = normalizeText(lead.industry);
  const country = normalizeText(lead.country || lead.crmCountry);
  const industryFilter = normalizeText(filter.industry);
  const countryFilter = normalizeText(filter.country);
  const industryMatches = !industryFilter || industry === industryFilter;
  const countryMatches = !countryFilter || country === countryFilter;
  return industryMatches && countryMatches;
}

function getFilteredCRMLeads(leads = getCRMLeads()) {
  return leads.filter(crmMatchesCurrentFilter);
}

function hasCRMFilter() {
  return Boolean(normalizeText(state.crmFilter.country) || normalizeText(state.crmFilter.industry));
}

function addLeadToCRM(lead) {
  const nextLead = decorateLeadForCRM(lead);
  const crm = getCRMLeads();
  const key = getLeadKey(nextLead);
  const existingIndex = crm.findIndex((item) => getLeadKey(item) === key);
  if (existingIndex >= 0) {
    crm[existingIndex] = {
      ...crm[existingIndex],
      ...nextLead,
      addedAt: crm[existingIndex].addedAt || nextLead.addedAt,
    };
    saveCRMLeads(crm);
    renderCRM();
    setStatus(`${nextLead.company} 已在 CRM，已更新标签`);
    return;
  }
  saveCRMLeads([...crm, nextLead]);
  renderCRM();
  setStatus(`已加入 CRM：${nextLead.company}`);
}

const OUTREACH_FORBIDDEN_PATTERNS = [
  /FOREIGN INVESTORS/gi,
  /National flag/gi,
  /Vietnamese/gi,
  /Declaration/gi,
  /Skip to content/gi,
  /Home Products/gi,
  /首页导航/gi,
  /版权信息/gi,
  /菜单文字/gi,
  /网页HTML/gi,
  /SEO文字/gi,
  /copyright/gi,
  /all rights reserved/gi,
  /privacy policy/gi,
  /terms (?:and|&) conditions/gi,
  /request a quote/gi,
  /dealer log in/gi,
  /search for:? search/gi,
  /main menu/gi,
];

function cleanOutreachText(value) {
  let cleaned = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[{}[\]<>|\\]/g, ' ')
    .replace(/\b(?:home|menu|catalog|login|search|contact|about|privacy|terms|cart|wishlist|subscribe)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  OUTREACH_FORBIDDEN_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, ' ');
  });

  return cleaned.replace(/\s+/g, ' ').trim();
}

function inferCompanyProfile(lead) {
  const company = cleanOutreachText(lead.company || 'the company') || 'the company';
  const haystack = cleanOutreachText([
    lead.company,
    lead.product,
    lead.summary,
    lead.website,
  ].filter(Boolean).join(' ')).toLowerCase();

  const profile = {
    company,
    industry: 'its industry',
    business: 'specialized products and services for business customers',
    products: 'relevant commercial products',
    advantages: 'a public website, visible market presence, and reachable contact channels',
  };

  if (/(led|lighting|lamp|fixture|luminair|illumination)/i.test(haystack)) {
    return {
      company,
      industry: 'LED lighting',
      business: 'commercial and industrial LED lighting solutions',
      products: 'indoor and outdoor LED fixtures, lamps, lighting controls, and project lighting products',
      advantages: 'energy-efficient product options, a focused lighting catalog, and support for business or project buyers',
    };
  }

  if (/(jewelry|jewellery|bracelet|necklace|ring|accessor)/i.test(haystack)) {
    return {
      company,
      industry: 'fashion jewelry and accessories',
      business: 'jewelry manufacturing, wholesale, or custom accessory supply',
      products: 'fashion jewelry, custom pieces, and retail-ready accessories',
      advantages: 'product specialization, wholesale relevance, and clear fit for buyer conversations',
    };
  }

  if (/(furniture|chair|table|cabinet|sofa|wood)/i.test(haystack)) {
    return {
      company,
      industry: 'furniture and home products',
      business: 'furniture supply and project-ready interior products',
      products: 'furniture, fixtures, and related interior product lines',
      advantages: 'visible product range and potential fit for sourcing or distribution discussions',
    };
  }

  if (/(hardware|tool|fastener|industrial|component|engineering)/i.test(haystack)) {
    return {
      company,
      industry: 'industrial hardware',
      business: 'industrial components, hardware, or engineering products',
      products: 'hardware products, components, and industrial supply items',
      advantages: 'technical product relevance and potential fit for procurement conversations',
    };
  }

  const compact = cleanOutreachText(lead.product || lead.summary || '');
  if (compact && compact.length >= 20) {
    profile.business = compact.slice(0, 110);
    profile.products = compact.slice(0, 90);
  }
  return profile;
}

function buildCleanCompanySummary(lead) {
  const profile = inferCompanyProfile(lead);
  return `${profile.company} appears to operate in ${profile.industry}, with a focus on ${profile.business}. Its product scope includes ${profile.products}. Public information suggests strengths in ${profile.advantages}.`;
}

function removeForbiddenOutreachContent(value) {
  let cleaned = String(value || '');
  OUTREACH_FORBIDDEN_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });
  return cleaned.replace(/\s{2,}/g, ' ').replace(/ \n/g, '\n').trim();
}

function createCopyButton(text) {
  return `<button class="copy-btn" data-copy="${escapeHtml(text)}">复制</button>`;
}

function createTxtButton(text, filename) {
  return `<button class="copy-btn" data-download="${escapeHtml(filename)}" data-txt="${escapeHtml(text)}">下载TXT</button>`;
}

function createRegenerateButton() {
  return '<button class="mini-btn regenerate-btn">重新生成</button>';
}

function encodeComposeValue(value) {
  return encodeURIComponent(String(value || ''));
}

function normalizeWhatsAppPhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 7 ? digits : '';
}

function createOpenButton(label, url, copyText = '') {
  return `<button class="mini-btn open-link-btn" data-url="${escapeHtml(url)}" data-copy-before-open="${escapeHtml(copyText)}">${escapeHtml(label)}</button>`;
}

function buildGmailUrl({ to, subject, body }) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeComposeValue(to)}&su=${encodeComposeValue(subject)}&body=${encodeComposeValue(body)}`;
}

function buildOutlookUrl({ to, subject, body }) {
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeComposeValue(to)}&subject=${encodeComposeValue(subject)}&body=${encodeComposeValue(body)}`;
}

function buildWhatsAppUrl({ phone, body }) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  const message = encodeComposeValue(body);
  return normalizedPhone
    ? `https://wa.me/${normalizedPhone}?text=${message}`
    : `https://web.whatsapp.com/send?text=${message}`;
}

function buildLinkedInUrl(lead) {
  return lead.linkedin || 'https://www.linkedin.com/messaging/';
}

function createDraftActions({ type, body, lead, subject }) {
  const emailSubject = type === 'followup' ? `Follow-up: ${subject}` : subject;
  const emailActions = `
    ${createOpenButton('Gmail', buildGmailUrl({ to: lead.email || '', subject: emailSubject, body }))}
    ${createOpenButton('Outlook', buildOutlookUrl({ to: lead.email || '', subject: emailSubject, body }))}
  `;
  if (type === 'whatsapp') {
    return `${createOpenButton('WhatsApp', buildWhatsAppUrl({ phone: lead.whatsapp || lead.phone || '', body }))}${emailActions}`;
  }
  if (type === 'linkedin') {
    return `${createOpenButton('LinkedIn', buildLinkedInUrl(lead), body)}${emailActions}`;
  }
  return emailActions;
}

function createDraftCard({ title, body, filename, lead, type = 'text', subject = '' }) {
  const safeFilename = `${(lead.company || 'lead').replace(/[^a-zA-Z0-9._-]+/g, '-')}-${filename}`;
  return `
    <div class="crm-draft-card">
      <div class="crm-draft-header">
        <div>
          <div class="crm-draft-title">${escapeHtml(title)}</div>
          <div class="crm-draft-subtitle">${escapeHtml(lead.company || '客户')}</div>
        </div>
        <div class="crm-actions">
          ${createDraftActions({ type, body: body || '', lead, subject })}
          ${createCopyButton(body || '')}
          ${createTxtButton(body || '', safeFilename)}
          ${createRegenerateButton()}
        </div>
      </div>
      <div class="crm-draft-body">${escapeHtml(body || '')}</div>
    </div>
  `;
}

function showLeadDetails(lead) {
  const detail = document.getElementById('detailContent');
  const bundle = state.generatedBundle || buildOutreachBundleFromLead(lead);
  const score = getStars(lead.score || 3);
  const priority = getLeadPriority(lead.score || 3);
  const summary = buildCleanCompanySummary(lead);
  const purchaseAdvice = buildPurchaseAdvice(lead);
  const companyInitial = (lead.company || 'C').charAt(0).toUpperCase();
  const logoMarkup = lead.website
    ? `<img class="crm-logo" src="${lead.website}/favicon.ico" alt="${escapeHtml(lead.company)} logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div class="crm-logo-fallback" style="display:none;">${escapeHtml(companyInitial)}</div>`
    : `<div class="crm-logo-fallback">${escapeHtml(companyInitial)}</div>`;

  detail.innerHTML = `
    <div class="crm-detail-layout">
      <section class="crm-profile-card">
        <div class="crm-profile-header">
          <div class="crm-profile-title-group">
            <div class="crm-logo-wrap">${logoMarkup}</div>
            <div>
              <div class="crm-eyebrow">客户资料</div>
              <h4>${escapeHtml(lead.company || '未知公司')}</h4>
              <span class="priority-pill ${priority.className}">${escapeHtml(priority.label)}</span>
              <span class="grade-pill ${getGradeClass(lead.grade)}">${escapeHtml(lead.grade || 'D')}级客户</span>
              <span class="ai-score-pill">AI推荐 ${escapeHtml(lead.aiRecommendationScore || 0)}</span>
            </div>
          </div>
        </div>

        <div class="crm-detail-columns">
          <div class="crm-info-block">
            <div class="crm-section-label">公司信息</div>
            <div class="crm-profile-meta">
          <div class="crm-meta-row"><span>公司</span><strong>${escapeHtml(lead.company || '—')}</strong></div>
          <div class="crm-meta-row"><span>官网</span>${lead.website ? `<a href="${lead.website}" target="_blank">${escapeHtml(lead.website)}</a>` : '<strong>—</strong>'}</div>
          <div class="crm-meta-row"><span>国家</span><strong>${escapeHtml(lead.country || '—')}</strong></div>
          <div class="crm-meta-row"><span>城市</span><strong>${escapeHtml(lead.city || '—')}</strong></div>
          <div class="crm-meta-row"><span>主营产品</span><strong>${escapeHtml(lead.product || '—')}</strong></div>
          <div class="crm-meta-row"><span>地址</span><strong>${escapeHtml(lead.address || '未公开')}</strong></div>
          <div class="crm-meta-row"><span>成立时间</span><strong>${escapeHtml(lead.foundedYear || '—')}</strong></div>
          <div class="crm-meta-row"><span>员工数量</span><strong>${escapeHtml(lead.employeeSize || '—')}</strong></div>
              <div class="crm-meta-row score-row"><span>采购评分</span><strong>${score}</strong></div>
              <div class="crm-meta-row score-row"><span>企业评分</span><strong>${escapeHtml(formatScore(lead.companyScore))}</strong></div>
              <div class="crm-meta-row score-row"><span>联系人完整度</span><strong>${escapeHtml(formatScore(lead.contactCompletenessScore))}</strong></div>
              <div class="crm-meta-row score-row"><span>AI推荐指数</span><strong>${escapeHtml(lead.aiRecommendationScore || 0)}</strong></div>
            </div>
          </div>

          <div class="crm-info-block">
            <div class="crm-section-label">联系方式</div>
            <div class="crm-profile-meta">
              <div class="crm-meta-row"><span>Email</span><strong>${escapeHtml(lead.email || '未公开')}</strong></div>
              <div class="crm-meta-row"><span>Phone</span><strong>${escapeHtml(lead.phone || '未公开')}</strong></div>
              <div class="crm-meta-row"><span>WhatsApp</span><strong>${escapeHtml(lead.whatsapp || '未公开')}</strong></div>
              <div class="crm-meta-row"><span>联系人</span><strong>${escapeHtml(lead.contact || '未公开')}</strong></div>
              <div class="crm-meta-row"><span>职位</span><strong>${escapeHtml(lead.contactTitle || '未公开')}</strong></div>
              <div class="crm-meta-row"><span>LinkedIn</span>${lead.linkedin ? `<a href="${lead.linkedin}" target="_blank">${escapeHtml(lead.linkedin)}</a>` : '<strong>—</strong>'}</div>
              <div class="crm-meta-row"><span>Facebook</span>${lead.facebook ? `<a href="${lead.facebook}" target="_blank">${escapeHtml(lead.facebook)}</a>` : '<strong>—</strong>'}</div>
              <div class="crm-meta-row"><span>Instagram</span>${lead.instagram ? `<a href="${lead.instagram}" target="_blank">${escapeHtml(lead.instagram)}</a>` : '<strong>—</strong>'}</div>
              <div class="crm-meta-row"><span>Google Maps</span>${lead.googleMaps ? `<a href="${lead.googleMaps}" target="_blank">${escapeHtml(lead.googleMaps)}</a>` : '<strong>—</strong>'}</div>
              <div class="crm-meta-row"><span>官方网址</span>${lead.website ? `<a href="${lead.website}" target="_blank">${escapeHtml(lead.website)}</a>` : '<strong>—</strong>'}</div>
            </div>
          </div>
        </div>

        <div class="crm-analysis-grid">
          <div class="crm-summary-box">
            <div class="crm-summary-title">AI总结</div>
            <p>${escapeHtml(summary)}</p>
          </div>

          <div class="crm-summary-box">
            <div class="crm-summary-title">为什么推荐开发</div>
            <p>${escapeHtml(lead.recommendation || '具备潜在合作价值')}</p>
          </div>

          <div class="crm-summary-box">
            <div class="crm-summary-title">采购建议</div>
            <p>${escapeHtml(purchaseAdvice)}</p>
          </div>
        </div>
      </section>

      <section class="crm-assistant-card">
        <div class="crm-assistant-header">
          <div>
            <div class="crm-eyebrow">AI 助手</div>
            <h4>真实官网驱动的外联内容</h4>
          </div>
          <button class="mini-btn regenerate-all-btn">全部重新生成</button>
        </div>
        <div class="crm-draft-stack">
          ${createDraftCard({ title: 'Email Subject', body: bundle.subject || `Potential collaboration with ${lead.company}`, filename: 'subject.txt', lead, type: 'email', subject: bundle.subject || `Potential collaboration with ${lead.company}` })}
          ${createDraftCard({ title: 'Cold Email', body: bundle.email || '', filename: 'cold-email.txt', lead, type: 'email', subject: bundle.subject || `Potential collaboration with ${lead.company}` })}
          ${createDraftCard({ title: 'WhatsApp', body: bundle.whatsapp || '', filename: 'whatsapp.txt', lead, type: 'whatsapp' })}
          ${createDraftCard({ title: 'LinkedIn Message', body: bundle.linkedin || '', filename: 'linkedin.txt', lead, type: 'linkedin' })}
          ${createDraftCard({ title: 'Follow-up 1', body: bundle.followup1 || '', filename: 'followup-1.txt', lead, type: 'followup', subject: bundle.subject || `Potential collaboration with ${lead.company}` })}
          ${createDraftCard({ title: 'Follow-up 2', body: bundle.followup2 || '', filename: 'followup-2.txt', lead, type: 'followup', subject: bundle.subject || `Potential collaboration with ${lead.company}` })}
        </div>
      </section>
    </div>
  `;

  detail.querySelectorAll('.open-link-btn').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const copyBeforeOpen = btn.getAttribute('data-copy-before-open') || '';
      if (copyBeforeOpen) {
        try {
          await navigator.clipboard.writeText(copyBeforeOpen);
          setStatus('已复制 LinkedIn 消息并打开页面');
        } catch (_error) {
          setStatus('正在打开 LinkedIn 消息页面');
        }
      } else {
        setStatus('正在打开外联页面');
      }
      window.open(btn.getAttribute('data-url') || '#', '_blank', 'noopener,noreferrer');
    });
  });

  detail.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-download')) {
        const filename = btn.getAttribute('data-download') || 'content.txt';
        const text = btn.getAttribute('data-txt') || '';
        downloadBlob(text, filename, 'text/plain;charset=utf-8;');
        setStatus('已下载 TXT');
      } else {
        navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
        setStatus('已复制内容');
      }
    });
  });

  detail.querySelectorAll('.regenerate-btn, .regenerate-all-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.generatedBundle = buildOutreachBundleFromLead(lead);
      showLeadDetails(lead);
      setStatus('已重新生成外联内容');
    });
  });
}

function renderLeads() {
  const grid = document.getElementById('leadGrid');
  const count = document.getElementById('resultCount');
  if (!state.leads.length) {
    const emptyText = state.searchMeta
      ? '本次未找到符合条件的真实企业。可调整国家、行业或关键词后重新搜索。'
      : '尚未进行搜索，请输入国家、行业和关键词。';
    grid.innerHTML = `<div class="lead-card"><p class="muted">${emptyText}</p></div>`;
    count.textContent = '0 家客户';
    renderSearchSummary(state.searchMeta);
    return;
  }

  count.textContent = `${state.leads.length} 家客户`;
  renderSearchSummary(state.searchMeta);
  grid.innerHTML = state.leads.map((lead) => {
    const priority = getLeadPriority(lead.score || 3);
    const grade = getLeadGrade(lead);
    const inCRM = isLeadInCRM(lead);
    return `
    <div class="lead-card ${priority.className} ${getGradeClass(grade)}" data-company="${escapeHtml(lead.company)}">
      <div class="lead-top">
        <strong>${escapeHtml(lead.company)}</strong>
        <span class="ai-score-pill">AI推荐 ${escapeHtml(lead.aiRecommendationScore ?? 0)}</span>
      </div>
      <div class="lead-priority-row">
        <span class="grade-pill ${getGradeClass(grade)}">${escapeHtml(grade)}级</span>
        <span class="priority-pill ${priority.className}">${getStars(lead.score || 3)} ${escapeHtml(priority.label)}</span>
      </div>
      <div class="lead-data-grid">
        <p class="meta">企业评分：${escapeHtml(formatScore(lead.companyScore))}</p>
        <p class="meta">联系人完整度：${escapeHtml(formatScore(lead.contactCompletenessScore))}</p>
        <p class="meta">AI推荐指数：${escapeHtml(formatScore(lead.aiRecommendationScore))}</p>
        <p class="meta">客户等级：${escapeHtml(grade)}级</p>
      </div>
      <p class="meta">${escapeHtml(lead.country)} · ${escapeHtml(lead.source)}</p>
      <div class="lead-data-grid">
        <p class="meta">邮箱：${escapeHtml(lead.email || '未公开')}</p>
        <p class="meta">电话：${escapeHtml(lead.phone || '未公开')}</p>
        <p class="meta">联系人：${escapeHtml(lead.contact || '未公开')}</p>
        <p class="meta">职位：${escapeHtml(lead.contactTitle || '未公开')}</p>
        <p class="meta">城市：${escapeHtml(lead.city || '—')}</p>
        <p class="meta">成立时间：${escapeHtml(lead.foundedYear || '—')}</p>
      </div>
      <p class="meta">官网：${escapeHtml(lead.website || '—')}</p>
      <p class="meta">主营业务：${escapeHtml(lead.product || '—')}</p>
      <div class="button-row">
        ${lead.website ? `<a class="mini-btn" href="${lead.website}" target="_blank">官网</a>` : ''}
        ${lead.website ? `<a class="mini-btn" href="${lead.website}/contact" target="_blank">联系页面</a>` : ''}
        <button class="mini-btn add-crm-btn ${inCRM ? 'added' : ''}" data-company="${escapeAttribute(lead.company)}">${inCRM ? '已在CRM' : '加入CRM'}</button>
      </div>
      <p class="meta">${escapeHtml(lead.recommendation)}</p>
    </div>
  `;
  }).join('');

  grid.querySelectorAll('.add-crm-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const company = btn.getAttribute('data-company');
      const selected = state.leads.find((item) => item.company === company);
      if (!selected) return;
      addLeadToCRM(selected);
      renderLeads();
    });
  });

  grid.querySelectorAll('.lead-card').forEach((card) => {
    card.addEventListener('click', () => {
      const company = card.getAttribute('data-company');
      const selected = state.leads.find((item) => item.company === company);
      if (!selected) return;
      state.selectedLead = selected;
      state.generatedBundle = buildOutreachBundleFromLead(selected);
      showLeadDetails(selected);
      setStatus(`已选择 ${selected.company}`);
    });
  });
}

function buildOutreachBundleFromLead(lead) {
  const profile = inferCompanyProfile(lead);
  const company = profile.company || 'the company';
  const country = lead.country || 'your target market';
  const city = lead.city ? `, ${lead.city}` : '';
  const summary = buildCleanCompanySummary({ ...lead, company });
  const bundle = {
    subject: `Potential collaboration with ${company}`,
    email: `Hi ${company} team,\n\nI came across ${company} while researching ${profile.industry} companies in ${country}${city}. From your public website, I understand that your team focuses on ${profile.business}, including ${profile.products}.\n\nThat stood out because companies in this segment often value partners who can respond quickly, communicate clearly, and support practical sourcing or growth conversations. Your apparent strengths in ${profile.advantages} make ${company} a relevant company to approach.\n\nWould you be open to a short conversation this week to see whether there may be a useful fit?`,
    whatsapp: `Hi ${company} team, I reviewed your public website and understand that you focus on ${profile.business}. I thought there may be a practical fit for a short conversation around ${profile.industry}. Would you be open to a quick chat this week?`,
    linkedin: `Hi ${company} team, I came across ${company} while reviewing ${profile.industry} companies in ${country}${city}. Your public information suggests a focus on ${profile.business}, and I would be interested in learning more about your current priorities.`,
    followup1: `Hi ${company} team, I wanted to follow up on my earlier note. I reviewed your public website and saw that ${company} appears focused on ${profile.business}. If this is relevant, I would be glad to share a few ideas and learn whether there is room for a short conversation.`,
    followup2: `Hi ${company} team, just sharing one final note. Based on your public information around ${profile.products}, I believe there may be a practical reason to connect. If timing is better later, I would be happy to keep the conversation brief and focused.`,
  };
  return Object.fromEntries(Object.entries(bundle).map(([key, value]) => [key, removeForbiddenOutreachContent(value)]));
}

function renderCRM() {
  const body = document.getElementById('crmBody');
  const filterBar = document.getElementById('crmFilterBar');
  const allCRM = getCRMLeads();
  const crm = getFilteredCRMLeads(allCRM);
  const filterActive = hasCRMFilter();

  if (filterBar) {
    const country = state.crmFilter.country || '全部国家';
    const industry = state.crmFilter.industry || '全部行业';
    filterBar.innerHTML = `
      <div class="crm-filter-copy">
        <span>CRM 当前视图</span>
        <strong>${escapeHtml(country)}</strong>
        <strong>${escapeHtml(industry)}</strong>
        <em>${crm.length}/${allCRM.length} 家</em>
      </div>
      ${filterActive ? '<button class="mini-btn" id="clearCRMFilterBtn">查看全部CRM</button>' : ''}
    `;
    const clearBtn = document.getElementById('clearCRMFilterBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.crmFilter = { country: '', industry: '' };
        renderCRM();
        setStatus('已显示全部 CRM 客户');
      });
    }
  }

  if (!allCRM.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">CRM 暂无客户。搜索结果只是临时列表，点击“加入CRM”后才会保存到长期客户库。</td></tr>';
    return;
  }

  if (!crm.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">当前搜索标签下暂无 CRM 客户。可从上方搜索结果点击“加入CRM”，或查看全部 CRM。</td></tr>';
    return;
  }
  body.innerHTML = crm.map((lead) => `
    <tr>
      <td>${escapeHtml(lead.company)}</td>
      <td><span class="tag-pill industry-tag">${escapeHtml(lead.industry || '未标记行业')}</span></td>
      <td><span class="tag-pill country-tag">${escapeHtml(lead.country || '未标记国家')}</span></td>
      <td><span class="grade-pill ${getGradeClass(lead.grade)}">${escapeHtml(lead.grade || 'D')}级</span></td>
      <td>${escapeHtml(lead.email || '—')}</td>
      <td>${escapeHtml(lead.phone || '—')}</td>
      <td>${getStars(lead.score)}</td>
      <td><button data-company="${escapeAttribute(lead.company)}" class="mini-btn">查看</button></td>
    </tr>
  `).join('');
  body.querySelectorAll('.mini-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const selected = crm.find((item) => item.company === btn.getAttribute('data-company'));
      if (selected) {
        state.selectedLead = selected;
        state.generatedBundle = buildOutreachBundleFromLead(selected);
        showLeadDetails(selected);
        setStatus(`已从 CRM 读取 ${selected.company}`);
      }
    });
  });
}

function generateMessages(lead) {
  const language = document.getElementById('languageSelect').value;
  const templates = {
    en: {
      email: `Hello ${lead.company} Team,\n\nI came across your company while researching ${lead.product || 'your market presence'}. I believe there may be a good fit for a short conversation around growth opportunities and potential collaboration.\n\nWould you be open to a brief introduction call next week?`,
      whatsapp: `Hi ${lead.company} team, I noticed your company in ${lead.country} and thought we could be a strong fit for a short conversation about collaboration opportunities. Would you be open to a quick chat this week?`,
    },
    es: {
      email: `Hola equipo de ${lead.company},\n\nme interesó su empresa mientras investigaba ${lead.product || 'su actividad'}. Creo que podría existir una oportunidad interesante para conversar sobre colaboración y crecimiento.\n\n¿Les interesaría una breve llamada la próxima semana?`,
      whatsapp: `Hola equipo de ${lead.company}, vi su empresa en ${lead.country} y pensé que podría ser útil conversar sobre posibles oportunidades de colaboración. ¿Les interesaría una charla breve esta semana?`,
    },
    fr: {
      email: `Bonjour équipe ${lead.company},\n\nj’ai trouvé votre entreprise lors de mes recherches sur ${lead.product || 'vos activités'}. Je pense qu’une courte conversation sur des opportunités de collaboration pourrait être pertinente.\n\nSeriez-vous disponibles pour un bref appel la semaine prochaine ?`,
      whatsapp: `Bonjour équipe ${lead.company}, j’ai vu votre entreprise en ${lead.country} et je pense qu’une brève conversation sur des opportunités de collaboration pourrait être utile. Seriez-vous disponible pour un échange rapide cette semaine ?`,
    },
    de: {
      email: `Hallo ${lead.company} Team,\n\nbei meiner Recherche zu ${lead.product || 'Ihren Aktivitäten'} ist Ihr Unternehmen aufgefallen. Ich glaube, ein kurzer Austausch über mögliche Kooperationen und Wachstumschancen könnte sinnvoll sein.\n\nWären Sie bereit, nächste Woche ein kurzes Gespräch zu führen?`,
      whatsapp: `Hallo ${lead.company} Team, ich habe Ihr Unternehmen in ${lead.country} entdeckt und dachte, ein kurzer Austausch über mögliche Kooperationen könnte sinnvoll sein. Wären Sie bereit, diese Woche kurz zu sprechen?`,
    },
  };
  const template = templates[language] || templates.en;
  document.getElementById('emailDraft').value = template.email;
  document.getElementById('whatsappDraft').value = template.whatsapp;
}

function exportCRM() {
  const crm = getCRMLeads();
  if (!crm.length) {
    setStatus('CRM 暂无客户可导出');
    return;
  }
  const rows = crm.map((lead) => [
    lead.company,
    lead.industry || '',
    lead.country || '',
    lead.grade || 'D',
    lead.email || '',
    lead.phone || '',
    lead.score,
    lead.website || '',
  ]);
  const csv = [['公司', '行业', '国家', '客户等级', '邮箱', '电话', '评分', '官网'], ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(csv, 'crm-leads.csv', 'text/csv;charset=utf-8;');
  setStatus(`已导出 ${crm.length} 家客户 CSV`);
}

function getExportLeads() {
  if (state.leads.length) return state.leads;
  return getCRMLeads();
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportCustomersExcel() {
  const leads = getExportLeads();
  if (!leads.length) {
    setStatus('暂无客户可导出');
    return;
  }

  const exportedAt = new Date().toLocaleString('zh-CN');
  const rows = leads.map((lead, index) => {
    const score = lead.score || scoreLead(lead);
    const advice = buildPurchaseAdvice({ ...lead, score });
    return `
      <tr>
        <td class="index">${index + 1}</td>
        <td class="company">${escapeHtml(lead.company || '')}</td>
        <td><a href="${escapeAttribute(lead.website || '')}">${escapeHtml(lead.website || '')}</a></td>
        <td>${escapeHtml(lead.email || '')}</td>
        <td>${escapeHtml(lead.phone || '')}</td>
        <td>${escapeHtml(lead.whatsapp || '')}</td>
        <td><a href="${escapeAttribute(lead.linkedin || '')}">${escapeHtml(lead.linkedin || '')}</a></td>
        <td class="score">${escapeHtml(getStars(score))}</td>
        <td>${escapeHtml(lead.grade || 'D')}</td>
        <td>${escapeHtml(advice)}</td>
        <td>${escapeHtml(lead.country || '')}</td>
        <td>${escapeHtml(lead.product || '')}</td>
      </tr>
    `;
  }).join('');

  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>客户列表</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
          body { font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; }
          table { border-collapse: collapse; width: 100%; }
          .title { background: #0f2742; color: #ffffff; font-size: 20px; font-weight: 700; height: 38px; }
          .subtitle { background: #eaf3ff; color: #35516d; height: 28px; }
          th { background: #163b63; color: #ffffff; font-weight: 700; border: 1px solid #9fb6cf; height: 32px; }
          td { border: 1px solid #c8d5e3; padding: 8px; vertical-align: top; mso-number-format: "\\@"; }
          tr:nth-child(even) td { background: #f7fbff; }
          .index { text-align: center; color: #64748b; }
          .company { font-weight: 700; color: #0f2742; }
          .score { color: #0f766e; font-weight: 700; }
          a { color: #1d4ed8; text-decoration: underline; }
        </style>
      </head>
      <body>
        <table>
          <colgroup>
            <col style="width:46px" />
            <col style="width:210px" />
            <col style="width:260px" />
            <col style="width:210px" />
            <col style="width:150px" />
            <col style="width:150px" />
            <col style="width:260px" />
            <col style="width:120px" />
            <col style="width:90px" />
            <col style="width:360px" />
            <col style="width:130px" />
            <col style="width:320px" />
          </colgroup>
          <tr><td class="title" colspan="12">海外客户开发 CRM - 客户导出</td></tr>
          <tr><td class="subtitle" colspan="12">导出时间：${escapeHtml(exportedAt)}　客户数量：${leads.length}</td></tr>
          <tr>
            <th>#</th>
            <th>公司</th>
            <th>官网</th>
            <th>邮箱</th>
            <th>电话</th>
            <th>WhatsApp</th>
            <th>LinkedIn</th>
            <th>评分</th>
            <th>等级</th>
            <th>采购建议</th>
            <th>国家</th>
            <th>主营业务</th>
          </tr>
          ${rows}
        </table>
      </body>
    </html>
  `;

  downloadBlob(workbook, `客户导出-${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel;charset=utf-8;');
  setStatus(`已导出 ${leads.length} 家客户 Excel`);
}

async function handleSearch() {
  const country = document.getElementById('countryInput').value.trim();
  const industry = document.getElementById('industryInput').value.trim();
  const keyword = '';
  if (!country || !industry) {
    setStatus('请填写国家和行业');
    return;
  }
  const startedAt = performance.now();
  state.currentSearch = { country, industry, keyword };
  state.crmFilter = { country, industry };
  state.searchMeta = {
    country,
    industry,
    keyword: industry,
    total: 0,
    elapsedMs: 0,
    engineCounts: { google: 0, bing: 0, duckDuckGo: 0 },
    sourceReturnedTotal: 0,
    filteredCount: 0,
    duplicateRemovedCount: 0,
    gradeCounts: { A: 0, B: 0, C: 0, D: 0 },
    expandedQueries: [],
  };
  renderSearchSummary(state.searchMeta);
  showSearchLoading();
  setStatus('AI正在全球搜索真实企业...');
  console.debug('[search request]', { country, industry });
  try {
    const response = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country, industry }),
    });
    const data = await response.json();
    console.debug('[search response]', {
      country,
      industry,
      count: data.companies?.length || 0,
      searchStats: data.searchStats,
    });
    if (!data.success) throw new Error(data.error || '搜索失败');
    state.leads = data.companies
      .map((lead) => ({
        ...lead,
        country: lead.country || country,
        industry,
        searchKeyword: industry,
        grade: lead.grade || 'D',
        aiRecommendationScore: lead.aiRecommendationScore || 0,
        companyScore: lead.companyScore || 0,
        contactCompletenessScore: lead.contactCompletenessScore || 0,
        score: lead.score || scoreLead(lead),
        recommendation: lead.recommendation || buildRecommendation(lead),
      }))
      .sort((a, b) => (b.aiRecommendationScore || 0) - (a.aiRecommendationScore || 0) || gradeRank(getLeadGrade(b)) - gradeRank(getLeadGrade(a)) || (b.score || 0) - (a.score || 0));
    state.searchMeta = {
      country,
      industry,
      keyword: industry,
      total: state.leads.length,
      elapsedMs: performance.now() - startedAt,
      engineCounts: data.searchStats || getSourceCounts(state.leads),
      sourceReturnedTotal: data.searchStats?.sourceReturnedTotal || 0,
      scoredCandidateCount: data.searchStats?.scoredCandidateCount || state.leads.length,
      filteredCount: 0,
      duplicateRemovedCount: data.searchStats?.duplicateRemovedCount || 0,
      gradeCounts: data.searchStats?.gradeCounts || {},
      expandedQueries: data.searchStats?.expandedQueries || [],
    };
    renderLeads();
    renderCRM();
    if (state.leads.length) {
      state.selectedLead = state.leads[0];
      state.generatedBundle = buildOutreachBundleFromLead(state.leads[0]);
      showLeadDetails(state.leads[0]);
    }
    setStatus(`已找到 ${state.leads.length} 家临时搜索结果，可手动加入 CRM`);
  } catch (error) {
    setStatus('搜索失败，请稍后重试。');
    console.error(error);
  } finally {
    hideSearchLoading();
  }
}

async function handleEnrich() {
  const keyword = document.getElementById('enrichInput').value.trim();
  if (!keyword) {
    setStatus('请输入关键词');
    return;
  }
  setStatus('正在联网搜索公司信息…');
  try {
    const response = await fetch('/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });
    const data = await response.json();
    state.enrichedLeads = data.companies || [];
    renderEnrichedLeads();
    setStatus(`已补充 ${state.enrichedLeads.length} 家真实公司信息`);
  } catch (error) {
    setStatus('联网补充失败，请重试。');
    console.error(error);
  }
}

function renderEnrichedLeads() {
  const container = document.getElementById('enrichResults');
  if (!state.enrichedLeads.length) {
    container.innerHTML = '<div class="lead-card"><p class="muted">暂无联网补充结果。</p></div>';
    return;
  }
  container.innerHTML = state.enrichedLeads.map((lead) => `
    <div class="lead-card">
      <div class="lead-top">
        <strong>${escapeHtml(lead.company)}</strong>
        <span class="stars">${getStars(lead.score || 3)}</span>
      </div>
      <p class="meta">国家：${escapeHtml(lead.country || '—')}</p>
      <p class="meta">官网：${lead.website ? `<a href="${lead.website}" target="_blank">${escapeHtml(lead.website)}</a>` : '—'}</p>
      <p class="meta">联系人：${escapeHtml(lead.contact || '—')}</p>
      <p class="meta">邮箱：${escapeHtml(lead.email || '未找到')}</p>
      <p class="meta">电话：${escapeHtml(lead.phone || '未找到')}</p>
      <p class="meta">WhatsApp：${escapeHtml(lead.whatsapp || '未找到')}</p>
      <p class="meta">主营产品：${escapeHtml(lead.product || '—')}</p>
      <p class="meta">数据来源：${escapeHtml(lead.source || '—')}</p>
      <div class="button-row">
        ${lead.website ? `<a class="mini-btn" href="${lead.website}" target="_blank">官网</a>` : ''}
        ${lead.website ? `<a class="mini-btn" href="${lead.website}/contact" target="_blank">联系页面</a>` : ''}
        ${createCopyButton(JSON.stringify(lead, null, 2))}
        ${createTxtButton(JSON.stringify(lead, null, 2), `${lead.company}-lead.txt`)}
      </div>
    </div>
  `).join('');
  container.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-download')) {
        const filename = btn.getAttribute('data-download') || 'content.txt';
        const text = btn.getAttribute('data-txt') || '';
        downloadBlob(text, filename, 'text/plain;charset=utf-8;');
        setStatus('已下载 TXT');
      } else {
        navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
        setStatus('已复制内容');
      }
    });
  });
}

function exportEnrichedCSV() {
  if (!state.enrichedLeads.length) {
    setStatus('暂无联网补充客户可导出');
    return;
  }
  const rows = state.enrichedLeads.map((lead) => [lead.company, lead.country, lead.email || '', lead.phone || '', lead.whatsapp || '', lead.website || '', lead.product || '', lead.source || '']);
  const csv = [['公司', '国家', '邮箱', '电话', 'WhatsApp', '官网', '主营产品', '数据来源'], ...rows].map((row) => row.join(',')).join('\n');
  downloadBlob(csv, 'enriched-leads.csv', 'text/csv;charset=utf-8;');
  setStatus(`已导出 ${state.enrichedLeads.length} 家补充客户 CSV`);
}

function init() {
  renderCRM();
  document.getElementById('searchBtn').addEventListener('click', handleSearch);
  document.getElementById('exportBtn').addEventListener('click', exportCRM);
  document.getElementById('exportExcelBtn').addEventListener('click', exportCustomersExcel);
  document.getElementById('enrichBtn').addEventListener('click', handleEnrich);
  document.getElementById('exportEnrichBtn').addEventListener('click', exportEnrichedCSV);
  document.getElementById('languageSelect').addEventListener('change', () => {
    if (state.selectedLead) generateMessages(state.selectedLead);
  });
}

init();
