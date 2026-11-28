import os
import pytest
from app.domains.projects.po_intake.service import extract_po
from app.domains.projects.po_intake import detect

SAMPLE_FILE = "/Users/hemamalinik/Hema/cms_backend/Hashemi5e_9781975297992_BLF_kj.xlsx"

@pytest.mark.skipif(not os.path.exists(SAMPLE_FILE), reason="Sample file not found")
def test_wk_blf_extraction():
    result = extract_po(SAMPLE_FILE, "Hashemi5e_9781975297992_BLF_kj.xlsx")
    assert result["template_detected"] == detect.WK_BLF
    assert not result["warnings"]

    fields = result["fields"]
    assert fields["project_title"] == "MRI: The Basics"
    assert fields["isbn_no"] == "9781975297992"
    assert fields["edition"] == "5th Edition"
    assert fields["category"] == "Med Practice"
    # Scheduled FTP date was not filled in the sample file, so due_date is None
    assert fields["due_date"] is None
    assert fields["chapter_count"] == 39
    assert fields["manuscript_pages"] == 615
    assert fields["estimated_pages"] == 432
    assert fields["color"] == "4c (CMYK)"
    assert fields["trim_size"] == "7 x 10"
    assert fields["client_project_manager"] == "Annika Shastry"
    assert fields["copyediting_level"] == "Level 2"
    assert fields["sample_chapter"] == "Chapter 18"
    assert fields["billing_type"] == "full"
    assert fields["billing_location"] == "S4Carlisle Publishing Services-Singapore"
    assert fields["accessibility"] == "yes"
    assert fields["sales_person"] == "550"

    extras = result["extras"]
    assert extras["author_names"] == ["Ray Hashemi"]
    assert len(extras["author_details"]) >= 2
    assert extras["author_details"][0]["name"] == "Ray Hashemi"
    assert extras["author_details"][1]["name"] == "Christopher J. Lisanti"
    assert extras["ebook_isbn"] == "9781975298012"
    assert extras["team"]["acquisitions_editor"] == "Nicole Dernoski"
    assert extras["team"]["development_editor"] == "Eric McDermott"
    assert extras["production_specs"]["copyediting_style"] == "AMA, 11e"

    ms_info = extras["manuscript_info"]
    assert ms_info["file_and_page_breakdown"]["chapters"]["at_launch"]["count"] == 39
    assert ms_info["file_and_page_breakdown"]["chapters"]["at_launch"]["pages"] == 574
    assert ms_info["file_and_page_breakdown"]["fm_files"]["at_launch"]["count"] == 1
    assert ms_info["manuscript_elements"]["References"] == "yes"
    assert ms_info["manuscript_elements"]["Math"] == "yes"
    assert ms_info["fm_elements"]["Preface"] == "yes"
    assert ms_info["bm_elements"]["# of appendices"] == 2
    assert ms_info["index_details"]["level"] == "Standard Offshore"

    art_info = extras["art_info"]
    assert art_info["art_prepared_by"] == "PPV"
    assert art_info["figure_counts"]["1c line"]["total"] == 325
    assert art_info["figure_counts"]["BW photo"]["total"] == 211
    assert art_info["figure_counts"]["Total"]["total"] == 594

    prod_info = extras["production_info"]
    assert prod_info["copyediting"]["level"] == "Standard Offshore"
    assert prod_info["copyediting"]["primary_style"] == "AMA, 11e"
    assert prod_info["copyediting"]["double_number_figures_boxes_tables"] == "yes"
    assert prod_info["page_proofs"]["corrections_to_come_from"] == "Dr. Lisanti"
    assert prod_info["page_proofs"]["first_pass_proofs_to"]["Authors"] == "yes"

    design_info = extras["design_info"]
    assert design_info["trim_size"] == "7 x 10"
    assert design_info["number_of_columns"] == 2
    assert design_info["colors"] == "4c (CMYK)"
    assert design_info["interior_complexity"] == "Simple"
    assert design_info["color_insert"] == "no"

    digital_info = extras["digital_info"]
    assert digital_info["standard_formats"] == "yes"
    assert digital_info["epub3"] == "yes"
    assert digital_info["conversion_type"] == "Enhanced"
    assert digital_info["enhanced_features"]["Exam simulator"] == "yes"
    assert digital_info["enhanced_features"]["Quizzing"] == "yes"
    assert "review questions" in digital_info["notes"]
    assert "Chapter 39" in digital_info["notes"]
