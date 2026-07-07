// src/report/build.js — 스냅샷 리포트(JSON 객체) → 방문 전 읽기용 Markdown 리포트
// 순수 함수(파일 I/O 없음). index.js가 조회 후 이 함수로 .md 리포트를 생성한다.

const GRADE_LABEL = { A: '공식 API', B: '공공DB 간접', C: '추정/프록시', D: '데이터 공백' };

// 표 셀 안전 처리 — 파이프/개행 이스케이프, 공백값은 명시
function cell(v) {
  if (v == null || v === '') return '— _(공백)_';
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// 필드 → 표 한 줄: 항목 | 값 | 신뢰도 | 출처·기준일 | 비고
function fieldRows(fields) {
  return fields
    .map((f) => {
      const val = f.data_gap ? '**— 데이터 없음(gap)**' : cell(f.value);
      const stale = f.fresh === false ? ' ⚠기간초과' : '';
      const src = [f.source, f.as_of].filter(Boolean).join(' · ');
      const note = f.note ? cell(f.note) : '';
      return `| ${cell(f.key)} | ${val}${stale} | ${f.grade} | ${cell(src)} | ${note} |`;
    })
    .join('\n');
}

function blockSection(title, fields) {
  if (!fields || !fields.length) return '';
  const gaps = fields.filter((f) => f.data_gap).length;
  const head = `## ${title}${gaps ? ` _(공백 ${gaps}건)_` : ''}\n\n`;
  return (
    head +
    '| 항목 | 값 | 신뢰도 | 출처·기준일 | 비고 |\n' +
    '|---|---|:--:|---|---|\n' +
    fieldRows(fields) +
    '\n'
  );
}

export function buildMarkdown(report) {
  const m = report.meta;
  const all = [...report.basic, ...report.capacity, ...report.finance];
  const gapTotal = all.filter((f) => f.data_gap).length;
  const qDate = new Date(m.query_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

  const out = [];
  out.push(`# 방문 전 사전검증 리포트 — ${m.vendor_name}\n`);
  out.push(
    [
      `- **조회시점**: ${qDate}`,
      `- **스냅샷 버전**: v${m.version}`,
      `- **전체 신뢰도**: ${m.overall_grade} (${GRADE_LABEL[m.overall_grade] || '—'})`,
      `- **수집 필드**: ${all.length}개 · **데이터 공백**: ${gapTotal}건 · **리스크 플래그**: ${report.risk_flags.length}건`,
      `- **사용 출처**: ${m.sources_used.join(', ') || '—'}`,
      `- **최신성 기준**: ${m.max_age_years}년 초과 데이터 자동 제외`,
    ].join('\n') + '\n'
  );

  // 리스크 플래그 — 방문 전 최우선 확인
  if (report.risk_flags.length) {
    out.push('## ⚠ 리스크 플래그 (방문 전 최우선 확인)\n');
    out.push(report.risk_flags.map((f) => `- **[${f.type}]** ${cell(f.detail || '')}`).join('\n') + '\n');
  }

  out.push(blockSection('기업 기본정보', report.basic));
  out.push(blockSection('생산역량 · 인원', report.capacity));
  out.push(blockSection('재무 (금융위)', report.finance));

  // 직전 버전 대비 변경
  if (report.diff_from_prev && report.diff_from_prev.length) {
    out.push('## 직전 버전 대비 변경\n');
    out.push(
      '| 항목 | 이전 | 현재 |\n|---|---|---|\n' +
        report.diff_from_prev.map((d) => `| ${cell(d.key)} | ${cell(d.before)} | ${cell(d.after)} |`).join('\n') +
        '\n'
    );
  }

  // 방문 크로스체크 — 현장 확인용 체크리스트
  out.push('## 방문 크로스체크 시트 (현장 확인용)\n');
  if (!report.crosscheck.length) {
    out.push('_크로스체크 대상 없음 — 모든 필드 A/B 등급이며 상충 없음._\n');
  } else {
    out.push('> 조회값과 현장 사실을 대조하세요. 공백 항목은 현장에서 신규 확보합니다.\n');
    out.push(
      report.crosscheck
        .map((r) => {
          const exp = r.expected == null ? '_없음 → 현장 확보 필요_' : cell(r.expected);
          return `- [ ] **${cell(r.key)}** — 조회값: ${exp}  ｜ 출처: ${cell(r.src_type)}  ｜ 현장확인: \`__________\``;
        })
        .join('\n') + '\n'
    );
  }

  out.push('---\n');
  out.push(
    '_신뢰도: A(공식 API) · B(공공DB 간접) · C(추정/프록시) · D(데이터 공백). ' +
      'vendor-scout 자동 생성 — 조회 1회 = 불변 스냅샷 1개._\n'
  );

  return out.join('\n');
}
