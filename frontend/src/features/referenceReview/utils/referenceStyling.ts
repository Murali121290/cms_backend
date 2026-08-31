export const CHAR_STYLE_COLOURS: Record<string, string> = {
  bib_alt_year: "#d8b4fe", bib_article: "#bae6fd", bib_base: "#e5e7eb",
  bib_book: "#93c5fd", bib_chapterno: "#e5e7eb", bib_chaptertitle: "#fdba74",
  bib_comment: "#c7d2fe", bib_confacronym: "#f472b6", bib_confdate: "#2dd4bf",
  bib_conference: "#60a5fa", bib_conflocation: "#f87171", bib_confpaper: "#86efac",
  bib_confproceedings: "#fbbf24", bib_day: "#fef08a", bib_deg: "#e5e7eb",
  bib_doi: "#fef08a", bib_ed_etal: "#22d3ee", bib_ed_fname: "#fef08a",
  bib_editionno: "#facc15", bib_ed_organization: "#fbcfe8", bib_ed_suffix: "#a7f3d0",
  bib_ed_surname: "#facc15", bib_etal: "#bef264", bib_extlink: "#5eead4",
  bib_fname: "#fef9c3", bib_fpage: "#fef9c3", bib_institution: "#d1fae5",
  bib_isbn: "#f3f4f6", bib_issue: "#bfdbfe", bib_journal: "#ffedd5",
  bib_location: "#fecdd3", bib_lpage: "#e5e7eb", bib_medline: "#bae6fd",
  bib_month: "#bef264", bib_number: "#c084fc", bib_organization: "#d1fae5",
  bib_pagecount: "#22c55e", bib_papernumber: "#fef08a", bib_patent: "#38bdf8",
  bib_publisher: "#f472b6", bib_reportnum: "#818cf8", bib_school: "#fb923c",
  bib_season: "#ea580c", bib_series: "#ffedd5", bib_seriesno: "#fef08a",
  bib_suffix: "#e5e7eb", bib_suppl: "#fef9c3", bib_surname: "#bef264",
  bib_title: "#fbcfe8", bib_trans: "#bef264", bib_unpubl: "#e5e7eb",
  bib_url: "#d9f99d", bib_volcount: "#22c55e", bib_volume: "#bae6fd",
  bib_year: "#e9d5ff",
  cite_app: "#bef264", cite_base: "#e5e7eb", cite_bib: "#cffafe",
  cite_box: "#e5e7eb", cite_eq: "#fdba74", cite_fig: "#bbf7d0",
  cite_fn: "#fbcfe8", cite_sec: "#fecdd3", cite_tbl: "#fca5a5",
  cite_tfn: "#fed7aa",
};

export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function getPlainTextFromHTML(html: string): string {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  
  // Remove all <del> elements (rejected track changes deletions)
  const dels = doc.querySelectorAll("del");
  dels.forEach((del) => del.remove());
  
  // Get plain text content
  return doc.body.textContent || "";
}

export function styleReferenceText(text: string): string {
  if (!text) return "";
  
  let rawText = text.trim();
  
  // 1. Identify and extract DOI
  const doiRegex = /(doi:\s*10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+|https?:\/\/doi\.org\/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/i;
  const doiMatch = rawText.match(doiRegex);
  let doiText = "";
  if (doiMatch) {
    doiText = doiMatch[0];
    rawText = rawText.replace(doiRegex, "").trim();
  }

  // 1b. Identify and extract PubMed/Medline IDs
  const pubmedRegex = /(pubmed:\s*\d+|pmid:\s*\d+)/i;
  const pubmedMatch = rawText.match(pubmedRegex);
  let pubmedText = "";
  if (pubmedMatch) {
    pubmedText = pubmedMatch[0];
    rawText = rawText.replace(pubmedRegex, "").trim();
  }
  
  // 2. Extract leading number (AMA style)
  const numRegex = /^(\[?\d+\]?[\.\s]+)/;
  const numMatch = rawText.match(numRegex);
  let numText = "";
  if (numMatch) {
    numText = numMatch[0];
    rawText = rawText.substring(numText.length).trim();
  }
  
  // 3. Determine if APA or AMA
  const apaYearRegex = /\s+\(((?:19|20)\d{2}[a-z]?|n\.d\.|in\s+press)\)/i;
  const isAPA = apaYearRegex.test(rawText);
  
  let authors = "";
  let year = "";
  let rest = "";
  
  if (isAPA) {
    const yearMatch = rawText.match(apaYearRegex);
    if (yearMatch && yearMatch.index !== undefined) {
      authors = rawText.substring(0, yearMatch.index).trim();
      year = yearMatch[1];
      rest = rawText.substring(yearMatch.index + yearMatch[0].length).trim();
      if (rest.startsWith(".")) rest = rest.substring(1).trim();
    }
  } else {
    // AMA Style - split by first period to isolate authors
    const firstPeriodIndex = rawText.indexOf(".");
    if (firstPeriodIndex !== -1) {
      authors = rawText.substring(0, firstPeriodIndex).trim();
      rest = rawText.substring(firstPeriodIndex + 1).trim();
    } else {
      authors = rawText;
    }
  }
  
  // Parse and style Authors
  let styledAuthors = "";
  if (authors) {
    const authorList = authors.split(/,|\b&\b/);
    styledAuthors = authorList.map((authStr) => {
      const trimmed = authStr.trim();
      if (!trimmed) return "";
      
      if (trimmed.toLowerCase().includes("et al")) {
        return `<span class="bib_etal">${escapeHTML(trimmed)}</span>`;
      }
      
      const parts = trimmed.split(/\s+/);
      if (parts.length > 1) {
        const isInitials = /^[A-Z]\.?(\s*[A-Z]\.?)*$/.test(parts[0]);
        if (isInitials) {
          return `<span class="bib_fname">${escapeHTML(trimmed)}</span>`;
        } else {
          const lastPart = parts[parts.length - 1];
          if (/^[A-Z]\.?([A-Z]\.?)*$/.test(lastPart)) {
            const surname = parts.slice(0, -1).join(" ");
            return `<span class="bib_surname">${escapeHTML(surname)}</span> <span class="bib_fname">${escapeHTML(lastPart)}</span>`;
          }
          return `<span class="bib_surname">${escapeHTML(trimmed)}</span>`;
        }
      }
      return `<span class="bib_surname">${escapeHTML(trimmed)}</span>`;
    }).join(", ");
  }
  
  // Parse rest of elements (Title, Journal, Volume, Issue, Pages)
  let styledRest = "";
  if (rest) {
    if (isAPA) {
      const parts = rest.split(".");
      const title = parts[0] || "";
      const journalAndMore = parts.slice(1).join(".").trim();
      
      styledRest += ` <span class="bib_title">${escapeHTML(title)}</span>.`;
      
      if (journalAndMore) {
        let styledJournal = escapeHTML(journalAndMore);
        const volIssuePages = /(\d+)\((\d+)\),\s*(\d+)([-–—])(\d+)/;
        const volPages = /(\d+),\s*(\d+)([-–—])(\d+)/;
        
        const commaIndex = journalAndMore.indexOf(",");
        if (commaIndex !== -1) {
          const journalName = journalAndMore.substring(0, commaIndex).trim();
          const journalRest = journalAndMore.substring(commaIndex).trim();
          let styledJRest = escapeHTML(journalRest);
          if (volIssuePages.test(styledJRest)) {
            styledJRest = styledJRest.replace(volIssuePages, '<span class="bib_volume">$1</span>(<span class="bib_issue">$2</span>), <span class="bib_fpage">$3</span>$4<span class="bib_lpage">$5</span>');
          } else if (volPages.test(styledJRest)) {
            styledJRest = styledJRest.replace(volPages, '<span class="bib_volume">$1</span>, <span class="bib_fpage">$2</span>$3<span class="bib_lpage">$4</span>');
          }
          styledRest += ` <span class="bib_journal"><em>${escapeHTML(journalName)}</em></span>${styledJRest}`;
        } else {
          styledRest += ` <span class="bib_journal"><em>${styledJournal}</em></span>`;
        }
      }
    } else {
      // AMA Style rest: Title, Journal, Year;Volume(Issue):Pages
      const yearVolRegex = /\b((?:19|20)\d{2})\b/;
      const yearMatch = rest.match(yearVolRegex);
      
      if (yearMatch && yearMatch.index !== undefined) {
        const titleAndJournal = rest.substring(0, yearMatch.index).trim();
        const yearVolPages = rest.substring(yearMatch.index).trim();
        
        const tjParts = titleAndJournal.split(".");
        let title = "";
        let journal = "";
        if (tjParts.length > 2) {
          title = tjParts.slice(0, -2).join(".").trim();
          journal = tjParts[tjParts.length - 2].trim();
        } else if (tjParts.length === 2) {
          title = tjParts[0].trim();
          journal = tjParts[1].trim();
        } else {
          journal = titleAndJournal;
        }
        
        if (title) styledRest += ` <span class="bib_title">${escapeHTML(title)}</span>.`;
        if (journal) styledRest += ` <span class="bib_journal"><em>${escapeHTML(journal)}</em></span>.`;
        
        let styledYVP = escapeHTML(yearVolPages);
        const yvpRegex = /\b(\d{4})\b;(\d+)\((\d+)\):(\d+)([-–—])(\d+)/;
        const yvpNoIssueRegex = /\b(\d{4})\b;(\d+):(\d+)([-–—])(\d+)/;
        const yvpNoPagesRegex = /\b(\d{4})\b;(\d+)\((\d+)\):(\d+)/;
        
        if (yvpRegex.test(styledYVP)) {
          styledYVP = styledYVP.replace(yvpRegex, '<span class="bib_year">$1</span>;<span class="bib_volume">$2</span>(<span class="bib_issue">$3</span>):<span class="bib_fpage">$4</span>$5<span class="bib_lpage">$6</span>');
        } else if (yvpNoIssueRegex.test(styledYVP)) {
          styledYVP = styledYVP.replace(yvpNoIssueRegex, '<span class="bib_year">$1</span>;<span class="bib_volume">$2</span>:<span class="bib_fpage">$3</span>$4<span class="bib_lpage">$5</span>');
        } else if (yvpNoPagesRegex.test(styledYVP)) {
          styledYVP = styledYVP.replace(yvpNoPagesRegex, '<span class="bib_year">$1</span>;<span class="bib_volume">$2</span>(<span class="bib_issue">$3</span>):<span class="bib_fpage">$4</span>');
        } else {
          const justYearRegex = /\b(\d{4})\b/g;
          styledYVP = styledYVP.replace(justYearRegex, '<span class="bib_year">$1</span>');
        }
        
        styledRest += ` ${styledYVP}`;
      } else {
        styledRest += ` ${escapeHTML(rest)}`;
      }
    }
  }
  
  let result = "";
  if (numText) result += `<span class="bib_chapterno">${escapeHTML(numText)}</span>`;
  if (styledAuthors) result += styledAuthors + (isAPA ? "" : ".");
  if (isAPA && year) result += ` (<span class="bib_year">${escapeHTML(year)}</span>).`;
  if (styledRest) result += styledRest;
  if (doiText) {
    result += `, <span class="bib_doi">${escapeHTML(doiText)}</span>`;
  }
  if (pubmedText) {
    result += `, <span class="bib_medline">${escapeHTML(pubmedText)}</span>`;
  }
  
  return result;
}

export function diffWordsToHTML(oldStr: string, newStr: string, currentUser: string = "Editor"): string {
  const oldWords = oldStr.split(/(\s+)/);
  const newWords = newStr.split(/(\s+)/);

  const dp: number[][] = Array(oldWords.length + 1).fill(0).map(() => Array(newWords.length + 1).fill(0));
  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = oldWords.length;
  let j = newWords.length;
  const result: string[] = [];
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      result.push(escapeHTML(oldWords[i - 1]));
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      const text = newWords[j - 1];
      if (text.trim() !== "") {
        result.push(`<ins data-author="${currentUser}" data-date="${timestamp}">${escapeHTML(text)}</ins>`);
      } else {
        result.push(text);
      }
      j--;
    } else {
      const text = oldWords[i - 1];
      if (text.trim() !== "") {
        result.push(`<del data-author="${currentUser}" data-date="${timestamp}">${escapeHTML(text)}</del>`);
      } else {
        result.push(text);
      }
      i--;
    }
  }

  const diffHtml = result.reverse().join("");
  const doiRegex = /(doi:\s*10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+|https?:\/\/doi\.org\/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/gi;
  return diffHtml.replace(doiRegex, (match) => {
    return `<span class="bib_doi">${match}</span>`;
  });
}

export function styledDiffHTML(oldStr: string, newStr: string, currentUser: string = "Editor"): string {
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const styledOld = styleReferenceText(oldStr);
  const styledNew = styleReferenceText(newStr);

  if (!oldStr || !oldStr.trim()) {
    return `<ins class="tc-insert" data-author="${currentUser}" data-date="${timestamp}">${styledNew}</ins>`;
  }

  return `<del class="tc-delete" data-author="${currentUser}" data-date="${timestamp}">${styledOld}</del> <ins class="tc-insert" data-author="${currentUser}" data-date="${timestamp}">${styledNew}</ins>`;
}
