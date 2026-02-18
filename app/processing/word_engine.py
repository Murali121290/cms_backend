import os
import time
import subprocess
import pythoncom
import win32com.client as win32
import pywintypes
from typing import List, Optional

# Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MACROS_DIR = os.path.join(BASE_DIR, "app", "processing", "macros")
DEFAULT_MACRO_NAME = "CE_Tool.dotm"
WORD_START_RETRIES = 3

# Macro Definitions
ROUTE_MACROS = {
    'language': {
        'name': 'Language Editing',
        'macros': [
            "LanguageEdit.GrammarCheck_WithErrorHandling",
            "LanguageEdit.SpellCheck_Advanced",
            "LanguageEdit.StyleConsistency_Check",
            "LanguageEdit.ReadabilityAnalysis",
            "LanguageEdit.TerminologyValidation"
        ]
    },
    'technical': {
        'name': 'Technical Editing',
        'macros': [
            "Referencevalidation.ValidateBWNumCite_WithErrorHandling",
            "ReferenceRenumber.Reorderbasedonseq",
            "Copyduplicate.duplicate4",
            "citationupdateonly.citationupdate",
            "techinal.technicalhighlight"
        ]
    },
    'macro_processing': {
        'name': 'Reference Processing',
        'macros': [
            "Referencevalidation.ValidateBWNumCite_WithErrorHandling",
            "ReferenceRenumber.Reorderbasedonseq",
            "Copyduplicate.duplicate4",
            "citationupdateonly.citationupdate",
            "Prediting.Preditinghighlight",
            "msrpre.GenerateDashboardReport",
        ]
    },
    'ppd': {
        'name': 'PPD Processing',
        'macros': [
            "PPD_HTML.GenerateDocument",
            "PPD_HTML.Generate_HTML_WORDReport",
        ]
    }
}

class OptimizedDocumentProcessor:
    def __init__(self):
        self.word = None
        self.docs = []
        self.macro_template_loaded = False

    def __enter__(self):
        pythoncom.CoInitialize()
        self.word = self._start_word_optimized()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._cleanup()

    def _start_word_optimized(self):
        # Kill existing instances first to ensure clean state
        subprocess.run(["taskkill", "/f", "/im", "winword.exe"], 
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                      
        for attempt in range(WORD_START_RETRIES):
            try:
                word = win32.Dispatch("Word.Application")
                word.Visible = False
                word.DisplayAlerts = False
                word.AutomationSecurity = 1  # msoAutomationSecurityByUI
                return word
            except Exception as e:
                if attempt == WORD_START_RETRIES - 1:
                    raise RuntimeError(f"Failed to start Word: {e}")
                time.sleep(1)

    def _load_macro_template(self):
        if self.macro_template_loaded:
            return True

        try:
            macro_path = os.path.join(MACROS_DIR, DEFAULT_MACRO_NAME)
            print(f"DEBUG: Loading macro template from {macro_path}")
            if not os.path.exists(macro_path):
                print(f"Macro template not found at {macro_path}")
                return False

            for addin in self.word.AddIns:
                try:
                    if hasattr(addin, 'FullName') and addin.FullName.lower().endswith(DEFAULT_MACRO_NAME.lower()):
                        self.macro_template_loaded = True
                        return True
                except:
                    continue

            self.word.AddIns.Add(macro_path, True)
            self.macro_template_loaded = True
            return True

        except Exception as e:
            print(f"Failed to load macro template: {str(e)}")
            return False

    def process_document(self, file_path: str, process_type: str) -> List[str]:
        """
        Process a single document with the macros defined for the given process_type.
        Returns a list of error messages (empty if successful).
        """
        errors = []

        if not self._load_macro_template():
            return ["Failed to load macro template"]

        route_config = ROUTE_MACROS.get(process_type)
        if not route_config:
            return [f"Unknown process type: {process_type}"]
            
        macros = route_config.get('macros', [])

        try:
            abs_path = os.path.abspath(file_path)
            if not os.path.exists(abs_path):
                return [f"File not found: {abs_path}"]

            doc = self.word.Documents.Open(abs_path, ReadOnly=False, AddToRecentFiles=False)
            self.docs.append(doc)

            # Run all macros for this type
            for macro_name in macros:
                try:
                    print(f"Running macro: {macro_name}")
                    self.word.Run(macro_name)
                except pywintypes.com_error as ce:
                    errors.append(f"COM error running '{macro_name}': {ce}")
                except Exception as me:
                    errors.append(f"Macro '{macro_name}' failed: {me}")

            # Save and close
            try:
                doc.Save()
                doc.Close(SaveChanges=False)
                self.docs.remove(doc)
            except Exception as se:
                errors.append(f"Failed to save document: {se}")

        except Exception as doc_err:
            errors.append(f"Document processing failed: {doc_err}")

        return errors

    def _cleanup(self):
        for doc in self.docs:
            try:
                doc.Close(SaveChanges=False)
            except:
                pass

        if self.word:
            try:
                self.word.Quit()
            except:
                pass

        try:
            pythoncom.CoUninitialize()
        except:
            pass
