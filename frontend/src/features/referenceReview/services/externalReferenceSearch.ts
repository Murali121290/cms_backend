export type SearchResultItem = {
  id: string;
  raw?: any;
  formatted: string;
  title: string;
  doi?: string;
  url?: string;
};

export function formatPubMedToStyle(doc: any, style: "AMA" | "APA" = "AMA"): string {
  const authorsList = doc.authors || [];
  const title = (doc.title || "").replace(/\.$/, "");
  const journal = doc.source || "";
  const pubdate = doc.pubdate || "";
  const yearMatch = pubdate.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";
  const volume = doc.volume || "";
  const issue = doc.issue || "";
  const pages = doc.pages || "";
  
  let doi = "";
  if (doc.articleids) {
    const doiObj = doc.articleids.find((id: any) => id.idtype === "doi");
    if (doiObj) {
      doi = doiObj.value;
    }
  }

  // Format authors
  let authorsFormatted = "";
  if (style === "AMA") {
    if (authorsList.length > 6) {
      authorsFormatted = authorsList.slice(0, 3).map((a: any) => a.name).join(", ") + ", et al";
    } else if (authorsList.length > 0) {
      authorsFormatted = authorsList.map((a: any) => a.name).join(", ");
    }
  } else {
    const parseName = (name: string) => {
      const parts = name.trim().split(/\s+/);
      if (parts.length > 1) {
        const last = parts[0];
        const initials = parts.slice(1).join("").split("").map(c => `${c}.`).join(" ");
        return `${last}, ${initials}`;
      }
      return name;
    };
    if (authorsList.length > 0) {
      const parsedAuthors = authorsList.map((a: any) => parseName(a.name));
      if (parsedAuthors.length > 1) {
        authorsFormatted = parsedAuthors.slice(0, -1).join(", ") + ", & " + parsedAuthors[parsedAuthors.length - 1];
      } else {
        authorsFormatted = parsedAuthors[0];
      }
    }
  }

  if (style === "AMA") {
    let res = "";
    if (authorsFormatted) res += `${authorsFormatted}. `;
    res += `${title}. `;
    if (journal) res += `${journal}. `;
    if (year) res += `${year}`;
    if (volume || issue || pages) {
      res += ";";
      if (volume) res += volume;
      if (issue) res += `(${issue})`;
      if (pages) res += `:${pages}`;
    }
    if (!res.endsWith(".")) res += ".";
    if (doi) {
      res += ` doi:${doi}`;
    }
    return res;
  } else {
    let res = "";
    if (authorsFormatted) res += `${authorsFormatted} `;
    if (year) res += `(${year}). `;
    res += `${title}. `;
    if (journal) res += `${journal}`;
    if (volume || issue || pages) {
      if (journal) res += ", ";
      if (volume) res += volume;
      if (issue) res += `(${issue})`;
      if (pages) {
        if (volume || issue) res += ", ";
        res += pages;
      }
    }
    if (!res.endsWith(".")) res += ".";
    if (doi) {
      res += ` https://doi.org/${doi}`;
    }
    return res;
  }
}

export function formatCrossRefToStyle(item: any, style: "AMA" | "APA" = "AMA"): string {
  const authorList = item.author || [];
  const title = (item.title && item.title[0] || "").replace(/\.$/, "");
  const journal = item["container-title"] && item["container-title"][0] || "";
  
  let year = "";
  const dateParts = item["published-print"]?.["date-parts"]?.[0] || item["published"]?.["date-parts"]?.[0] || item["published-online"]?.["date-parts"]?.[0];
  if (dateParts && dateParts.length > 0) {
    year = dateParts[0].toString();
  }

  const volume = item.volume || "";
  const issue = item.issue || "";
  const pages = item.page || "";
  const doi = item.DOI || "";

  // Format authors
  let authorsFormatted = "";
  if (style === "AMA") {
    const formatted = authorList.map((a: any) => {
      const initials = (a.given || "").split(/\s+/).map((p: string) => p[0] || "").join("");
      return `${a.family || ""} ${initials}`.trim();
    });
    if (formatted.length > 6) {
      authorsFormatted = formatted.slice(0, 3).join(", ") + ", et al";
    } else if (formatted.length > 0) {
      authorsFormatted = formatted.join(", ");
    }
  } else {
    const formatted = authorList.map((a: any) => {
      const initials = (a.given || "").split(/\s+/).map((p: string) => p[0] ? `${p[0]}.` : "").join(" ");
      return `${a.family || ""}, ${initials}`.trim();
    });
    if (formatted.length > 0) {
      if (formatted.length > 1) {
        authorsFormatted = formatted.slice(0, -1).join(", ") + ", & " + formatted[formatted.length - 1];
      } else {
        authorsFormatted = formatted[0];
      }
    }
  }

  if (style === "AMA") {
    let res = "";
    if (authorsFormatted) res += `${authorsFormatted}. `;
    res += `${title}. `;
    if (journal) res += `${journal}. `;
    if (year) res += `${year}`;
    if (volume || issue || pages) {
      res += ";";
      if (volume) res += volume;
      if (issue) res += `(${issue})`;
      if (pages) res += `:${pages}`;
    }
    if (!res.endsWith(".")) res += ".";
    if (doi) {
      res += ` doi:${doi}`;
    }
    return res;
  } else {
    let res = "";
    if (authorsFormatted) res += `${authorsFormatted} `;
    if (year) res += `(${year}). `;
    res += `${title}. `;
    if (journal) res += `${journal}`;
    if (volume || issue || pages) {
      if (journal) res += ", ";
      if (volume) res += volume;
      if (issue) res += `(${issue})`;
      if (pages) {
        if (volume || issue) res += ", ";
        res += pages;
      }
    }
    if (!res.endsWith(".")) res += ".";
    if (doi) {
      res += ` https://doi.org/${doi}`;
    }
    return res;
  }
}

export function formatGoogleBooksToStyle(volumeInfo: any, style: "AMA" | "APA" = "AMA"): string {
  const title = volumeInfo.title || "No Title";
  const publisher = volumeInfo.publisher || "";
  const publishedDate = volumeInfo.publishedDate || "";
  const year = publishedDate ? publishedDate.split("-")[0] : "";
  const authorsList = volumeInfo.authors || [];

  let authorsFormatted = "";
  if (style === "AMA") {
    const formatted = authorsList.map((a: string) => {
      const parts = a.trim().split(/\s+/);
      if (parts.length > 1) {
        const initials = parts.slice(0, -1).map(p => p[0] || "").join("");
        return `${parts[parts.length - 1]} ${initials}`;
      }
      return a;
    });
    if (formatted.length > 6) {
      authorsFormatted = formatted.slice(0, 3).join(", ") + ", et al";
    } else if (formatted.length > 0) {
      authorsFormatted = formatted.join(", ");
    }
  } else {
    const formatted = authorsList.map((a: string) => {
      const parts = a.trim().split(/\s+/);
      if (parts.length > 1) {
        const last = parts[parts.length - 1];
        const initials = parts.slice(0, -1).map(p => `${p[0] || ""}.`).join(" ");
        return `${last}, ${initials}`;
      }
      return a;
    });
    if (formatted.length > 0) {
      if (formatted.length > 1) {
        authorsFormatted = formatted.slice(0, -1).join(", ") + ", & " + formatted[formatted.length - 1];
      } else {
        authorsFormatted = formatted[0];
      }
    }
  }

  if (style === "AMA") {
    let res = "";
    if (authorsFormatted) res += `${authorsFormatted}. `;
    res += `${title}. `;
    if (publisher) res += `${publisher}; `;
    if (year) res += `${year}.`;
    return res;
  } else {
    let res = "";
    if (authorsFormatted) res += `${authorsFormatted} `;
    if (year) res += `(${year}). `;
    res += `${title}. `;
    if (publisher) res += `${publisher}.`;
    return res;
  }
}

export async function searchPubMed(query: string, style: "AMA" | "APA" = "AMA"): Promise<SearchResultItem[]> {
  if (!query.trim()) return [];
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=3`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();
  const idList = searchData?.esearchresult?.idlist || [];
  
  if (idList.length === 0) return [];

  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idList.join(",")}&retmode=json`;
  const fetchRes = await fetch(fetchUrl);
  const fetchData = await fetchRes.json();
  const results = fetchData?.result || {};

  return idList.map((id: string) => {
    const doc = results[id];
    if (!doc) return null;
    const formatted = formatPubMedToStyle(doc, style);
    return {
      id,
      raw: doc,
      formatted,
      title: doc.title || "",
      doi: doc.articleids?.find((i: any) => i.idtype === "doi")?.value || "",
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    };
  }).filter((item): item is SearchResultItem => item !== null);
}

export async function searchCrossRef(query: string, style: "AMA" | "APA" = "AMA"): Promise<SearchResultItem[]> {
  if (!query.trim()) return [];
  const searchUrl = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=3`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  const items = data?.message?.items || [];

  return items.map((item: any) => {
    const formatted = formatCrossRefToStyle(item, style);
    const doi = item.DOI || "";
    return {
      id: doi,
      raw: item,
      formatted,
      title: item.title?.[0] || "",
      doi,
      url: doi ? `https://doi.org/${doi}` : undefined,
    };
  });
}

export async function searchGoogleBooks(query: string, style: "AMA" | "APA" = "AMA"): Promise<SearchResultItem[]> {
  if (!query.trim()) return [];
  const searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=3`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  const items = data?.items || [];

  return items.map((item: any) => {
    const volumeInfo = item.volumeInfo || {};
    const formatted = formatGoogleBooksToStyle(volumeInfo, style);
    return {
      id: item.id || "",
      raw: item,
      formatted,
      title: volumeInfo.title || "",
      doi: "",
      url: volumeInfo.infoLink || undefined,
    };
  });
}

export async function searchWikipedia(query: string): Promise<SearchResultItem[]> {
  if (!query.trim()) return [];
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  const items = data?.query?.search || [];

  return items.map((item: any) => {
    const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`;
    const formatted = `${item.title}. Wikipedia, The Free Encyclopedia. Retrieved ${new Date().getFullYear()}. ${wikiUrl}`;
    return {
      id: item.pageid ? String(item.pageid) : "",
      raw: item,
      formatted,
      title: item.title,
      doi: "",
      url: wikiUrl,
    };
  });
}
