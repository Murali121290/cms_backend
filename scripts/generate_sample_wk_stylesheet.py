import os
import docx

template_path = os.path.abspath(r"app/processing/manuscript_core/templates/Editorial Style sheet_WK.docx")
out_path = os.path.abspath(r"Sample_Editorial_Style_sheet_WK.docx")
artifact_path = os.path.abspath(r"C:\Users\Muraliba\.gemini\antigravity\brain\d51a561c-4ce6-4405-a828-9431b0d3547a\Sample_Editorial_Style_sheet_WK.docx")

doc = docx.Document(template_path)

# Header paragraphs
doc.paragraphs[0].text = "Date: 18-Nov-2026"
doc.paragraphs[1].text = "Project: Project_178956"

# Table 0: Metadata
meta_values = [
    ("Customer:", "Wolters Kluwer Health / LWW"),
    ("CE Sample Chapter:", "Chapter 01 (Health Assessment & Clinical Judgment)"),
    ("Book Title", "Nursing Health Assessment: A Clinical Judgment Approach"),
    ("Author(s):", "Sharon Jensen, MN, RN"),
    ("Edition", "4th Edition (4e)"),
    ("Manual/Previous edition to be followed", "AMA Manual of Style, 11th Edition"),
    ("Book category", "Nursing Education / Clinical Judgment"),
]
for i, (k, v) in enumerate(meta_values):
    doc.tables[0].rows[i].cells[0].text = k
    doc.tables[0].rows[i].cells[1].text = v

# Table 1: Key Specifications mapping
spec_updates = {
    "Level of editing": "Standard / Medium CE",
    "Reference books, dictionaries followed": "AMA Manual of Style (11e), Merriam-Webster's Collegiate Dictionary (11e), Stedman's Medical Dictionary",
    "Head1": "ALL CAPS (bold)",
    "Head2": "Title Case (bold italic)",
    "Head3": "Title Case (italic)",
    "Preposition casing in head": "Lowercase prepositions under 4 letters; uppercase for 4+ letters (e.g., With, From, Into)",
    "Figure Citation style": "Direct: Figure 4.1 | Indirect: (Figure 4.1)",
    "Table citation style": "Table 1.1, Table 1.2 (arabic numerals with dot)",
    "year": "y",
    "month": "mo",
    "week": "wk",
    "day": "d",
    "hour": "h",
    "minute": "min",
    "second": "s",
    "Number usage (0–9/10 or above)": "Spell out zero to nine; use numerals for 10 and above (e.g., five patients, 12 doses)",
    "Ordinal number usage": "Spell out first through ninth; use numerals for 10th and above (10th, 11th)",
    "Fractions": "Spell out in text (two-thirds); use numerals with slash for mathematical expressions (1/3)",
    "“fold” style": "Use numerals with hyphen (e.g., 2-fold, 10-fold)",
    "Leading zero": "Yes, required before decimal point (0.5 mg, not .5 mg)",
    "Times": "Use numerals (3 times, 15 times)",
    "Percent style": "15% (closed symbol '%' with numerals; spell out 'percentage' without numbers)",
    "Dates, year, time (AM/PM/Hours)": "Month DD, YYYY (e.g., October 16, 2026); time: 10:30 AM / 4:15 PM",
    "Centuries": "Spell out 1st to 9th (ninth century); numerals for 20th century, 21st century",
    "Units (repeat?)": "Do not repeat units in ranges (10 to 20 mg); repeat % symbol (10% to 20%)",
    "Style for C and ratio": "Closed degree symbol: 37°C, 98.6°F",
    "Ranges": "Use 'to' in running text (10 to 20 mg); en dash permitted in parentheses and tables (10–20 mg)",
    "Statistical terms": "p < .05 (italic lowercase p, no leading zero per AMA); P value",
    "Currency": "$500 (standard symbol without space)",
    "Thousand separator style": "Comma separator for 4+ digits (1,000; 10,000)",
    "Virgule construction (Per or “/”)": "Use virgule (/) for standard units (mg/kg/d, mL/min); 'per' in prose",
    "kilodalton": "kDa",
    "liter": "L",
    "micrometer": "μm",
    "microgram": "μg",
    "microliter": "μL",
    "mm Hg/mmHg": "mm Hg (spaced)",
    "Abbreviations and acronyms style": "Spell out at first mention with abbreviation in parentheses: adenosine triphosphate (ATP)",
    "Trademark, copyright and registered symbol": "Delete trademark (™), registered (®), and copyright (©) symbols from running text",
    "e.g. and i.e.": "Use 'e.g.,' and 'i.e.,' with trailing comma inside parentheses; spell out in running text ('for example', 'that is')",
    "Em dash / En dash (parenthetical)": "Unspaced em dash (—) for parenthetical breaks; en dash (–) for ranges",
    "Citation style": "AMA 11e numbered citation style: superscript numbers without parentheses (e.g., text1,2)",
    "Spellings": "American English (Merriam-Webster 11th Collegiate: e.g., pediatric, color, anesthesia)",
    "Serial comma?": "Yes, mandatory serial (Oxford) comma before 'and'/'or' in a series of three or more items",
    "Hyphens (for prefixes, double vowels, consonants, technical terms)": "Compound adjectives hyphenated before noun (well-known factor); closed after prefixes (postoperative, noninvasive)",
    "Distinction between “which” and “that”": "Use 'that' for restrictive clauses (no comma); 'which' for nonrestrictive clauses (preceded by comma)",
    "Sexism, gender (he/she) usage)": "Use gender-neutral language and person-first terms (e.g., patient with diabetes, not diabetic patient)",
    "Medical eponyms usage": "Nonpossessive eponyms preferred per AMA (Alzheimer disease, Parkinson disease, Bell palsy)",
    "versus/v.s. usage": "Spell out 'versus' in running text; abbreviate as 'vs' in parentheses, figures, and tables",
}

t1 = doc.tables[1]
for r in t1.rows:
    if len(r.cells) >= 2:
        c0 = r.cells[0].text.strip()
        for pattern, replacement in spec_updates.items():
            if pattern.lower() in c0.lower():
                r.cells[1].text = replacement
                break

# Table 2: Word List
word_sample = {
    "A": ["acute-phase reactant", "adenosine diphosphate (ADP)", "Alzheimer disease", "anesthesia", "anteroposterior", "arrhythmia"],
    "B": ["back-and-forth", "baseline", "beta-blocker", "blood-brain barrier", "body mass index (BMI)"],
    "C": ["cardiovascular", "cerebrospinal fluid (CSF)", "computed tomography (CT)", "cortico-striato-thalamocortical", "craniocervical"],
    "D": ["database", "deep tendon reflex", "dopaminergic", "double-blind", "dysarthria"],
    "E": ["electroencephalogram (EEG)", "electromyography (EMG)", "end-stage", "epileptogenic", "etiology"],
    "F": ["fall-related", "first-line", "flaccid", "fluid-attenuated inversion recovery (FLAIR)", "follow-up (n/adj)"],
    "G": ["gamma-aminobutyric acid (GABA)", "ganglia-thalamocortical", "Glasgow Coma Scale (GCS)", "glucose", "gray matter"],
    "H": ["healthcare", "hemorrhage", "high-resolution", "hyperkinetic", "hypertension"],
    "I": ["immunotherapy", "in-office", "in vitro", "in vivo", "ischemic attack"],
    "J": ["jaw-jerk reflex", "joint position sense", "jugular vein"],
    "K": ["Koplik spots", "Krebs cycle", "Kussmaul breathing"],
    "L": ["left-sided", "leukoencephalopathy", "Lewy body", "lumbar puncture"],
    "M": ["magnetic resonance imaging (MRI)", "meta-analysis", "microglia", "middle cerebral artery", "multiple sclerosis"],
    "N": ["neuroimaging", "neurological", "neurotransmitter", "non-contrast", "normotensive"],
    "O": ["open-label", "ophthalmoplegia", "orthostatic", "oxygen saturation"],
    "P": ["Parkinson disease", "pathophysiology", "periventricular", "phenomenological", "positron emission tomography (PET)", "postoperative"],
    "Q": ["Q-wave infarction", "quality-of-life", "quantitative"],
    "R": ["randomized controlled trial (RCT)", "rapid eye movement (REM)", "receptor", "relapsing-remitting", "retrospective"],
    "S": ["second-line", "seizure", "sensory neuropathy", "standard deviation (SD)", "stroke", "subacute"],
    "T": ["T-wave inversion", "thrombolytic", "time course", "title case", "transient ischemic attack (TIA)", "treatment-resistant"],
    "U": ["ultra-high-field", "unilateral", "up-to-date", "upper motor neuron"],
    "V": ["vasoconstriction", "ventriculoperitoneal shunt", "versus", "visual field defect"],
    "W": ["white matter", "whole-body", "wide-complex tachycardia", "work-up"],
    "X": ["x-ray", "xenograft"],
    "Y": ["yield", "Young-Helmholtz theory"],
    "Z": ["zero-order kinetics", "Zellweger syndrome"],
}

t2 = doc.tables[2]
letters = [
    [("A", 0, 0), ("B", 0, 1), ("C", 0, 2)],
    [("D", 1, 0), ("E", 1, 1), ("F", 1, 2)],
    [("G", 2, 0), ("H", 2, 1), ("I", 2, 2)],
    [("J", 3, 0), ("K", 3, 1), ("L", 3, 2)],
    [("M", 4, 0), ("N", 4, 1), ("O", 4, 2)],
    [("P", 5, 0), ("Q", 5, 1), ("R", 5, 2)],
    [("S", 6, 0), ("T", 6, 1), ("U", 6, 2)],
    [("V", 7, 0), ("W", 7, 1), ("X", 7, 2)],
    [("Y", 8, 0), ("Z", 8, 1)],
]

for row_letters in letters:
    for let, r_idx, c_idx in row_letters:
        words = word_sample.get(let, [])
        cell = t2.rows[r_idx].cells[c_idx]
        lines = [let] + words
        cell.text = "\n".join(lines)

doc.save(out_path)
doc.save(artifact_path)
print(f"Generated {out_path} ({os.path.getsize(out_path)} bytes)")
print(f"Generated {artifact_path} ({os.path.getsize(artifact_path)} bytes)")
