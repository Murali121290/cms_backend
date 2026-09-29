from app.database import SessionLocal, Base, engine
import app.models
from app.domains.journals.models import (
    JournalClient, Journal, JournalArticle, JournalStageDetail,
    JournalStylesheet, JournalGrammarsheet
)
from app.domains.journals.service import initialize_article_stages

def seed_journal_data():
    # 1. Create tables if they do not exist
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # 2. Check if client exists
        client = db.query(JournalClient).filter(JournalClient.client_code == "ELSA-01").first()
        if not client:
            client = JournalClient(
                client_code="ELSA-01",
                publisher_name="Elsevier Publishing",
                jats_version="1.3",
                contact_email="journal-prod@elsevier.com",
                website="https://www.elsevier.com"
            )
            db.add(client)
            db.commit()
            db.refresh(client)
            print("✓ Created Journal Client: Elsevier Publishing (ELSA-01)")

        # 3. Check if journal exists
        journal = db.query(Journal).filter(Journal.journal_code == "JAIS").first()
        if not journal:
            journal = Journal(
                client_id=client.id,
                journal_code="JAIS",
                journal_title="Journal of AI & Neural Systems",
                issn_print="2049-3651",
                issn_online="2049-3652",
                volume="Vol 42",
                issue="Issue 3",
                status="Active"
            )
            db.add(journal)
            db.commit()
            db.refresh(journal)
            print("✓ Created Journal: Journal of AI & Neural Systems (JAIS)")

            # Create Journal-level Style & Grammar sheets
            stylesheet = JournalStylesheet(
                journal_id=journal.id,
                name="JAIS_Style_v2",
                description="Technical editing style rules for JAIS MathML and figure callouts",
                style_rules={"mathml": "standard", "figure_prefix": "Figure", "section_numbers": True}
            )
            grammarsheet = JournalGrammarsheet(
                journal_id=journal.id,
                name="JAIS_US_Grammar",
                language_variant="US_English",
                grammar_rules={"dictionary": "Merriam-Webster", "spelling": "US"}
            )
            db.add(stylesheet)
            db.add(grammarsheet)
            db.commit()
            print("✓ Created Journal Style & Grammar Sheets")

        # 4. Check if sample article exists
        article = db.query(JournalArticle).filter(JournalArticle.article_doi == "10.1016/j.jais.2026.04.001").first()
        if not article:
            article = JournalArticle(
                journal_id=journal.id,
                article_doi="10.1016/j.jais.2026.04.001",
                vendor_article_id="ART-2026-001",
                article_title="Deep Transformer Architectures for JATS XML Parsing",
                article_type="Research Article",
                lead_author="Dr. Aris Thorne",
                corresponding_email="athorne@harvard.edu",
                abstract="Automated publishing workflows demand high precision JATS XML transformation...",
                keywords=["JATS XML", "Transformers", "MathML", "XSLT"],
                current_stage="1. Pre-Editing (XHTML)",
                priority="Normal",
                complexity_level="Medium"
            )
            db.add(article)
            db.commit()
            db.refresh(article)
            
            # Initialize 8 stages for article
            initialize_article_stages(db, article)
            print("✓ Created Sample Article with 8 Stages: 10.1016/j.jais.2026.04.001")

        print("🎉 Journal Production database seeding completed successfully!")
    finally:
        db.close()

if __name__ == "__main__":
    seed_journal_data()
