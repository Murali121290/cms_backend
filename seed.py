"""
Seed script — inserts sample data into the database.
Run with:  python seed.py   (from the backend/ directory)

Safe to re-run: skips rows that already exist.
"""

import sys
import os

sys.stdout.reconfigure(encoding="utf-8")

import bcrypt
from sqlalchemy.exc import IntegrityError

sys.path.insert(0, os.path.dirname(__file__))

from app.init_db import SessionLocal, create_tables
from app.models.user import User
from app.models.roles_master import RolesMaster
from app.models.client import Client
from app.models.project import Project
from app.models.stage_master import StageMaster
from app.models.stage_activity_master import StageActivityMaster
from app.models.chapter_info import ChapterInfo
from app.models.stage_detail import StageDetail


def hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


# ── Sample data ───────────────────────────────────────────────────────────────
SAMPLE_ROLES = [
    # Admin Team
    {"role_name": "admin",                 "team": "Admin Team",          "description": "Full system access — all modules and settings",                   "active_status": True},
    # Preediting Team
    {"role_name": "manager",               "team": "Preediting Team",     "description": "Team and project management for the pre-editing workflow",         "active_status": True},
    {"role_name": "pereditor",             "team": "Preediting Team",     "description": "Pre-editing review and content preparation",                       "active_status": True},
    # Copyediting Team  (manager role reused in a different team)
    {"role_name": "manager",               "team": "Copyediting Team",    "description": "Team and project management for the copyediting workflow",         "active_status": True},
    {"role_name": "copyeditor",            "team": "Copyediting Team",    "description": "Language and style editing of manuscript content",                 "active_status": True},
    {"role_name": "technical_copyeditor",  "team": "Copyediting Team",    "description": "Technical accuracy review and domain-specific copyediting",        "active_status": True},
    # Typesetting Team
    {"role_name": "manager",               "team": "Typesetting Team",    "description": "Team and project management for the typesetting workflow",         "active_status": True},
    {"role_name": "typesetter",            "team": "Typesetting Team",    "description": "Page layout, formatting and typesetting of final manuscripts",     "active_status": True},
    # QA Team
    {"role_name": "manager",               "team": "QA Team",             "description": "Team and project management for quality assurance",                "active_status": True},
    {"role_name": "qa_reviewer",           "team": "QA Team",             "description": "Quality assurance review and sign-off on deliverables",            "active_status": True},
    # Operations Team
    {"role_name": "operations_manager",    "team": "Operations Team",     "description": "Operations oversight — workflows, scheduling and capacity",        "active_status": True},
    # Finance Team
    {"role_name": "finance_analyst",       "team": "Finance Team",        "description": "Finance module — read/write access to billing and invoicing data", "active_status": True},
    # Support Team
    {"role_name": "support",               "team": "Support Team",        "description": "Customer support — ticket handling and client communication",      "active_status": True},
    # General
    {"role_name": "viewer",                "team": "General",             "description": "Read-only access across all permitted modules",                    "active_status": False},
]

SAMPLE_USERS = [
    {"user_name": "admin_hema",     "email": "hema.admin@wms.com",     "password": "Admin@1234",    "role": "admin",    "team": "IT",          "customer_access": ["CUST001", "CUST002", "CUST003", "CUST004", "CUST005"], "active_status": True},
    {"user_name": "john_doe",       "email": "john.doe@wms.com",       "password": "John@5678",     "role": "manager",  "team": "Sales",       "customer_access": ["CUST001", "CUST002"],                                   "active_status": True},
    {"user_name": "jane_smith",     "email": "jane.smith@wms.com",     "password": "Jane@9012",     "role": "developer","team": "Engineering", "customer_access": ["CUST002"],                                              "active_status": True},
    {"user_name": "bob_wilson",     "email": "bob.wilson@wms.com",     "password": "Bob@3456",      "role": "analyst",  "team": "Data",        "customer_access": ["CUST003"],                                              "active_status": True},
    {"user_name": "alice_johnson",  "email": "alice.johnson@wms.com",  "password": "Alice@7890",    "role": "developer","team": "Engineering", "customer_access": ["CUST001"],                                              "active_status": True},
    {"user_name": "charlie_brown",  "email": "charlie.brown@wms.com",  "password": "Charlie@2345",  "role": "manager",  "team": "Operations",  "customer_access": ["CUST001", "CUST002", "CUST003"],                        "active_status": True},
    {"user_name": "diana_prince",   "email": "diana.prince@wms.com",   "password": "Diana@6789",    "role": "analyst",  "team": "Finance",     "customer_access": ["CUST004"],                                              "active_status": False},
    {"user_name": "evan_rogers",    "email": "evan.rogers@wms.com",    "password": "Evan@1357",     "role": "developer","team": "Engineering", "customer_access": ["CUST002", "CUST003"],                                   "active_status": True},
    {"user_name": "fiona_apple",    "email": "fiona.apple@wms.com",    "password": "Fiona@2468",    "role": "designer", "team": "UX",          "customer_access": ["CUST001", "CUST003"],                                   "active_status": True},
    {"user_name": "george_martin",  "email": "george.martin@wms.com",  "password": "George@1122",   "role": "manager",  "team": "HR",          "customer_access": ["CUST001", "CUST002", "CUST003", "CUST004"],             "active_status": True},
]

SAMPLE_PROJECTS = [
    {
        "client_division": "CUST001", "project_code": "PRJ-001",
        "customer_name": "Acme Corporation",    "division_code": "CUST001",
        "customer_contact": "Alice Turner",     "category": "Software Development",
        "workflow_name": "Agile Sprint",        "status": "Active",
        "project_manager": "john_doe",          "sales_person": "John Doe",
        "priority": "High",                     "project_title": "Enterprise ERP Integration Platform",
        "edition": "1st",  "color": "Full Color",  "trim_size": "8.5x11",
        "copyright_year": 2024, "manuscript_pages": 300, "estimated_pages": 320, "actual_pages": 150,
        "isbn_10": "1234567890", "isbn_13": "9781234567897", "billing_location": "San Francisco, CA",
    },
    {
        "client_division": "CUST001", "project_code": "PRJ-002",
        "customer_name": "Acme Corporation",    "division_code": "CUST001",
        "customer_contact": "Alice Turner",     "category": "Cloud Migration",
        "workflow_name": "DevOps Pipeline",     "status": "Planning",
        "project_manager": "charlie_brown",     "sales_person": "Jane Smith",
        "priority": "Medium",                   "project_title": "Cloud Infrastructure Migration Phase 2",
        "edition": "2nd",  "color": "Black & White",  "trim_size": "6x9",
        "copyright_year": 2024, "manuscript_pages": 150, "estimated_pages": 160, "actual_pages": 0,
        "isbn_10": "2345678901", "isbn_13": "9782345678904", "billing_location": "San Francisco, CA",
    },
    {
        "client_division": "CUST002", "project_code": "PRJ-003",
        "customer_name": "Beta Technologies",   "division_code": "CUST002",
        "customer_contact": "Brian Scott",      "category": "DevOps",
        "workflow_name": "CI/CD Workflow",      "status": "Active",
        "project_manager": "charlie_brown",     "sales_person": "Charlie Brown",
        "priority": "High",                     "project_title": "Automated Deployment Pipeline Setup",
        "edition": "1st",  "color": "Full Color",  "trim_size": "7x10",
        "copyright_year": 2024, "manuscript_pages": 200, "estimated_pages": 210, "actual_pages": 180,
        "isbn_10": "3456789012", "isbn_13": "9783456789011", "billing_location": "Austin, TX",
    },
    {
        "client_division": "CUST003", "project_code": "PRJ-004",
        "customer_name": "Gamma Retail Group",  "division_code": "CUST003",
        "customer_contact": "Catherine Wong",   "category": "E-commerce",
        "workflow_name": "Retail Workflow",     "status": "Active",
        "project_manager": "john_doe",          "sales_person": "John Doe",
        "priority": "High",                     "project_title": "Multi-Channel E-commerce Platform",
        "edition": "1st",  "color": "Full Color",  "trim_size": "8.5x11",
        "copyright_year": 2025, "manuscript_pages": 400, "estimated_pages": 420, "actual_pages": 200,
        "isbn_10": "4567890123", "isbn_13": "9784567890128", "billing_location": "Chicago, IL",
    },
    {
        "client_division": "CUST004", "project_code": "PRJ-005",
        "customer_name": "Delta Finance Ltd",   "division_code": "CUST004",
        "customer_contact": "David Patel",      "category": "Fintech",
        "workflow_name": "Banking Workflow",    "status": "Active",
        "project_manager": "george_martin",     "sales_person": "Alice Johnson",
        "priority": "High",                     "project_title": "Core Banking System Modernisation",
        "edition": "3rd",  "color": "Black & White",  "trim_size": "6x9",
        "copyright_year": 2024, "manuscript_pages": 500, "estimated_pages": 520, "actual_pages": 510,
        "isbn_10": "5678901234", "isbn_13": "9785678901235", "billing_location": "New York, NY",
    },
    {
        "client_division": "CUST005", "project_code": "PRJ-006",
        "customer_name": "Epsilon Healthcare",  "division_code": "CUST005",
        "customer_contact": "Eva Martins",      "category": "Healthcare IT",
        "workflow_name": "HMS Workflow",        "status": "Active",
        "project_manager": "george_martin",     "sales_person": "George Martin",
        "priority": "High",                     "project_title": "Hospital Management System Integration",
        "edition": "2nd",  "color": "Full Color",  "trim_size": "8x10",
        "copyright_year": 2025, "manuscript_pages": 350, "estimated_pages": 360, "actual_pages": 120,
        "isbn_10": "6789012345", "isbn_13": "9786789012342", "billing_location": "Boston, MA",
    },
    {
        "client_division": "CUST006", "project_code": "PRJ-007",
        "customer_name": "Zeta Logistics",      "division_code": "CUST006",
        "customer_contact": "Frank Nguyen",     "category": "Logistics",
        "workflow_name": "Fleet Workflow",      "status": "Active",
        "project_manager": "charlie_brown",     "sales_person": "Bob Wilson",
        "priority": "Medium",                   "project_title": "Real-Time Fleet Tracking Dashboard",
        "edition": "1st",  "color": "Full Color",  "trim_size": "11x8.5",
        "copyright_year": 2025, "manuscript_pages": 180, "estimated_pages": 190, "actual_pages": 90,
        "isbn_10": "7890123456", "isbn_13": "9787890123459", "billing_location": "Dallas, TX",
    },
    {
        "client_division": "CUST007", "project_code": "PRJ-008",
        "customer_name": "Eta Media Group",     "division_code": "CUST007",
        "customer_contact": "Grace Kim",        "category": "Media",
        "workflow_name": "Content Workflow",    "status": "Completed",
        "project_manager": "john_doe",          "sales_person": "Fiona Apple",
        "priority": "Low",                      "project_title": "Streaming Platform Content Management System",
        "edition": "1st",  "color": "Full Color",  "trim_size": "6x9",
        "copyright_year": 2023, "manuscript_pages": 220, "estimated_pages": 230, "actual_pages": 230,
        "isbn_10": "8901234567", "isbn_13": "9788901234566", "billing_location": "Los Angeles, CA",
    },
    {
        "client_division": "CUST009", "project_code": "PRJ-009",
        "customer_name": "Iota Education Hub",  "division_code": "CUST009",
        "customer_contact": "Isla Fernandez",   "category": "EdTech",
        "workflow_name": "LMS Workflow",        "status": "Planning",
        "project_manager": "george_martin",     "sales_person": "Diana Prince",
        "priority": "Medium",                   "project_title": "Learning Management System with AI Tutor",
        "edition": "1st",  "color": "Full Color",  "trim_size": "8.5x11",
        "copyright_year": 2025, "manuscript_pages": 250, "estimated_pages": 270, "actual_pages": 0,
        "isbn_10": "9012345678", "isbn_13": "9789012345673", "billing_location": "Seattle, WA",
    },
    {
        "client_division": "CUST010", "project_code": "PRJ-010",
        "customer_name": "Kappa Manufacturing", "division_code": "CUST010",
        "customer_contact": "Kevin Zhao",       "category": "IoT",
        "workflow_name": "Factory Workflow",    "status": "Active",
        "project_manager": "charlie_brown",     "sales_person": "Evan Rogers",
        "priority": "High",                     "project_title": "Smart Factory IoT Automation System",
        "edition": "1st",  "color": "Black & White",  "trim_size": "7x10",
        "copyright_year": 2025, "manuscript_pages": 280, "estimated_pages": 290, "actual_pages": 60,
        "isbn_10": "1023456789", "isbn_13": "9781023456780", "billing_location": "Detroit, MI",
    },
]

SAMPLE_CLIENTS = [
    # ── Organisations ──────────────────────────────────────────────────────────
    {
        "category_type": "organization", "contact_type": "Customer",
        "name_company": "Acme Corporation",      "company": "Acme Corporation",      "division": "CUST001",
        "designation": "CTO",                    "department": "Technology",
        "email": "contact@acme.com",             "website": "https://acme.com",
        "vendor_number": "VND001",
        "address1": "100 Silicon Ave",           "address2": "Suite 400",
        "city": "San Francisco",                 "state": "California",  "country": "USA", "zip_code": "94105",
        "sub_specialisation": "Enterprise Software", "working_hours": "09:00-18:00", "contact_hours": "09:00-17:00",
        "phone_main": "+1-415-555-0101",         "phone_additional": "+1-415-555-0102",
        "active_status": True,
    },
    {
        "category_type": "organization", "contact_type": "Customer",
        "name_company": "Beta Technologies",     "company": "Beta Technologies",     "division": "CUST002",
        "designation": "VP Engineering",         "department": "Engineering",
        "email": "info@betatech.com",            "website": "https://betatech.com",
        "vendor_number": "VND002",
        "address1": "200 Cloud Street",          "address2": None,
        "city": "Austin",                        "state": "Texas",       "country": "USA", "zip_code": "73301",
        "sub_specialisation": "Cloud & DevOps",  "working_hours": "08:00-17:00", "contact_hours": "08:00-16:00",
        "phone_main": "+1-512-555-0201",         "phone_additional": None,
        "active_status": True,
    },
    {
        "category_type": "organization", "contact_type": "Vendor",
        "name_company": "Gamma Retail Group",    "company": "Gamma Retail",          "division": "CUST003",
        "designation": "Head of IT",             "department": "IT",
        "email": "it@gammaretail.com",           "website": "https://gammaretail.com",
        "vendor_number": "VND003",
        "address1": "300 Commerce Blvd",         "address2": "Floor 2",
        "city": "Chicago",                       "state": "Illinois",    "country": "USA", "zip_code": "60601",
        "sub_specialisation": "E-commerce",      "working_hours": "10:00-19:00", "contact_hours": "10:00-18:00",
        "phone_main": "+1-312-555-0301",         "phone_additional": "+1-312-555-0302",
        "active_status": True,
    },
    {
        "category_type": "organization", "contact_type": "Customer",
        "name_company": "Delta Finance Ltd",     "company": "Delta Finance",         "division": "CUST004",
        "designation": "CIO",                    "department": "Finance",
        "email": "cio@deltafinance.com",         "website": "https://deltafinance.com",
        "vendor_number": "VND004",
        "address1": "400 Banking Lane",          "address2": None,
        "city": "New York",                      "state": "New York",    "country": "USA", "zip_code": "10001",
        "sub_specialisation": "Fintech & Banking", "working_hours": "08:00-17:00", "contact_hours": "09:00-17:00",
        "phone_main": "+1-212-555-0401",         "phone_additional": "+1-212-555-0402",
        "active_status": True,
    },
    {
        "category_type": "organization", "contact_type": "Customer",
        "name_company": "Epsilon Healthcare",    "company": "Epsilon Health",        "division": "CUST005",
        "designation": "Director IT",            "department": "Healthcare IT",
        "email": "it@epsilonhealth.com",         "website": "https://epsilonhealth.com",
        "vendor_number": "VND005",
        "address1": "500 Medical Drive",         "address2": "Block B",
        "city": "Boston",                        "state": "Massachusetts", "country": "USA", "zip_code": "02101",
        "sub_specialisation": "Hospital Management", "working_hours": "07:00-19:00", "contact_hours": "08:00-18:00",
        "phone_main": "+1-617-555-0501",         "phone_additional": None,
        "active_status": True,
    },
    # ── Persons ────────────────────────────────────────────────────────────────
    {
        "category_type": "person",       "contact_type": "Customer",
        "first_name": "Frank",           "surname": "Nguyen",
        "company": "Zeta Logistics",     "division": "CUST006",
        "designation": "Supply Chain Manager", "department": "Operations",
        "email": "frank.nguyen@zetalog.com",   "website": "https://zetalogistics.com",
        "vendor_number": "VND006",
        "address1": "600 Freight Road",  "address2": None,
        "city": "Dallas",                "state": "Texas",       "country": "USA", "zip_code": "75201",
        "sub_specialisation": "Supply Chain", "working_hours": "08:00-17:00", "contact_hours": "09:00-16:00",
        "phone_main": "+1-214-555-0601", "phone_additional": "+1-214-555-0602",
        "active_status": True,
    },
    {
        "category_type": "person",       "contact_type": "Vendor",
        "first_name": "Grace",           "surname": "Kim",
        "company": "Eta Media Group",    "division": "CUST007",
        "designation": "Creative Director", "department": "Media",
        "email": "grace.kim@etamedia.com",  "website": "https://etamedia.com",
        "vendor_number": "VND007",
        "address1": "700 Studio Street", "address2": "Suite 12",
        "city": "Los Angeles",           "state": "California",  "country": "USA", "zip_code": "90001",
        "sub_specialisation": "Digital Media", "working_hours": "10:00-18:00", "contact_hours": "10:00-17:00",
        "phone_main": "+1-323-555-0701", "phone_additional": None,
        "active_status": True,
    },
    {
        "category_type": "person",       "contact_type": "Customer",
        "first_name": "Henry",           "surname": "Osei",
        "company": "Theta Construction", "division": "CUST008",
        "designation": "Project Director", "department": "Construction",
        "email": "henry.osei@thetabuild.com", "website": None,
        "vendor_number": None,
        "address1": "800 Builder Ave",   "address2": None,
        "city": "Atlanta",               "state": "Georgia",     "country": "USA", "zip_code": "30301",
        "sub_specialisation": "Civil Engineering", "working_hours": "07:00-16:00", "contact_hours": "08:00-15:00",
        "phone_main": "+1-404-555-0801", "phone_additional": None,
        "active_status": False,
    },
    {
        "category_type": "person",       "contact_type": "Customer",
        "first_name": "Isla",            "surname": "Fernandez",
        "company": "Iota Education Hub", "division": "CUST009",
        "designation": "Head of Learning", "department": "Education",
        "email": "isla.fernandez@iotaedu.com", "website": "https://iotaedu.com",
        "vendor_number": "VND009",
        "address1": "900 Campus Lane",   "address2": "Building C",
        "city": "Seattle",               "state": "Washington",  "country": "USA", "zip_code": "98101",
        "sub_specialisation": "EdTech",  "working_hours": "09:00-17:00", "contact_hours": "09:00-16:00",
        "phone_main": "+1-206-555-0901", "phone_additional": "+1-206-555-0902",
        "active_status": True,
    },
    {
        "category_type": "person",       "contact_type": "Vendor",
        "first_name": "Kevin",           "surname": "Zhao",
        "company": "Kappa Manufacturing", "division": "CUST010",
        "designation": "Automation Engineer", "department": "Manufacturing",
        "email": "kevin.zhao@kappamfg.com",   "website": "https://kappamfg.com",
        "vendor_number": "VND010",
        "address1": "1000 Factory Blvd", "address2": None,
        "city": "Detroit",               "state": "Michigan",    "country": "USA", "zip_code": "48201",
        "sub_specialisation": "IoT & Automation", "working_hours": "06:00-15:00", "contact_hours": "07:00-14:00",
        "phone_main": "+1-313-555-1001", "phone_additional": None,
        "active_status": True,
    },
]

# Standalone activities — no stage ownership
SAMPLE_STAGE_ACTIVITIES = [
    # Initiation activities
    {"stage_activity_name": "Requirement Gathering",     "description": "Collect and document all functional and non-functional requirements from stakeholders",  "active_status": True},
    {"stage_activity_name": "Feasibility Study",         "description": "Assess technical, financial and operational feasibility of the proposed solution",        "active_status": True},
    {"stage_activity_name": "Stakeholder Identification","description": "Identify and document all project stakeholders and their roles and expectations",         "active_status": True},
    # Planning activities
    {"stage_activity_name": "Project Planning",          "description": "Define milestones, deliverables, timeline and success criteria",                         "active_status": True},
    {"stage_activity_name": "Resource Allocation",       "description": "Assign team members, tools and infrastructure to project workstreams",                   "active_status": True},
    {"stage_activity_name": "Risk Assessment",           "description": "Identify, evaluate and document project risks with mitigation strategies",                "active_status": True},
    # Design activities
    {"stage_activity_name": "UI Design",                 "description": "Create wireframes, high-fidelity mockups and interactive design prototypes",              "active_status": True},
    {"stage_activity_name": "Database Design",           "description": "Design relational schema, indexing strategy and data migration plan",                    "active_status": True},
    {"stage_activity_name": "Architecture Review",       "description": "Review and approve system architecture, technology stack and integration patterns",       "active_status": True},
    # Development activities
    {"stage_activity_name": "Frontend Development",      "description": "Build user interface components, pages and client-side application logic",               "active_status": True},
    {"stage_activity_name": "Backend Development",       "description": "Implement REST APIs, business logic, authentication and data access layer",               "active_status": True},
    {"stage_activity_name": "Database Implementation",   "description": "Create tables, stored procedures, indexes and seed reference data in the target database","active_status": True},
    # Testing activities
    {"stage_activity_name": "Unit Testing",              "description": "Write and execute tests for individual functions, methods and components in isolation",   "active_status": True},
    {"stage_activity_name": "Integration Testing",       "description": "Validate combined modules, API contracts and end-to-end data flows",                     "active_status": True},
    {"stage_activity_name": "UAT",                       "description": "Facilitate user acceptance testing with client representatives on staging environment",  "active_status": True},
    # Review activities
    {"stage_activity_name": "Code Review",               "description": "Peer review of source code for quality, security standards and best practices",           "active_status": True},
    {"stage_activity_name": "Client Review",             "description": "Present deliverables to client stakeholders and capture formal sign-off",                "active_status": True},
    {"stage_activity_name": "Performance Review",        "description": "Profile application under load, identify bottlenecks and validate SLA targets",           "active_status": True},
    # Deployment activities
    {"stage_activity_name": "Production Deployment",     "description": "Execute deployment runbook to release application to production environment",             "active_status": True},
    {"stage_activity_name": "Smoke Testing",             "description": "Run post-deployment sanity checks to confirm critical paths are operational",             "active_status": True},
    {"stage_activity_name": "Rollback Planning",         "description": "Prepare and validate rollback procedures in case of critical deployment failure",         "active_status": True},
    # Closure activities
    {"stage_activity_name": "Documentation",             "description": "Write technical architecture, API and end-user documentation for all delivered features", "active_status": True},
    {"stage_activity_name": "Project Handover",          "description": "Transfer ownership, credentials, runbooks and final deliverables to client or support",  "active_status": True},
    {"stage_activity_name": "Lessons Learned",           "description": "Conduct retrospective to capture process improvements and knowledge for future projects", "active_status": True},
]

# activity names resolved to IDs at seed time
SAMPLE_STAGES = [
    {
        "stage_name": "Initiation",
        "description": "Project kick-off, stakeholder alignment, requirements gathering and feasibility assessment",
        "activity_names": ["Requirement Gathering", "Stakeholder Identification", "Feasibility Study"],
        "sla_level1": 1, "sla_level2": 2, "sla_level3": 3,
        "roles": ["manager", "analyst"],
        "active_status": True,
    },
    {
        "stage_name": "Planning",
        "description": "Detailed project planning, resource allocation, risk assessment and scope definition",
        "activity_names": ["Project Planning", "Resource Allocation", "Risk Assessment"],
        "sla_level1": 3, "sla_level2": 5, "sla_level3": 7,
        "roles": ["manager", "operations_manager"],
        "active_status": True,
    },
    {
        "stage_name": "Design",
        "description": "System architecture, UI/UX design, database schema and integration design",
        "activity_names": ["Architecture Review", "UI Design", "Database Design"],
        "sla_level1": 5, "sla_level2": 7, "sla_level3": 10,
        "roles": ["designer", "developer"],
        "active_status": True,
    },
    {
        "stage_name": "Development",
        "description": "Full-stack implementation of frontend, backend and database layers",
        "activity_names": ["Frontend Development", "Backend Development", "Database Implementation"],
        "sla_level1": 14, "sla_level2": 21, "sla_level3": 28,
        "roles": ["developer"],
        "active_status": True,
    },
    {
        "stage_name": "Testing",
        "description": "Comprehensive testing including unit, integration and user acceptance testing",
        "activity_names": ["Unit Testing", "Integration Testing", "UAT"],
        "sla_level1": 5, "sla_level2": 7, "sla_level3": 10,
        "roles": ["developer", "analyst"],
        "active_status": True,
    },
    {
        "stage_name": "Review",
        "description": "Code quality review, performance validation and formal client sign-off",
        "activity_names": ["Code Review", "Performance Review", "Client Review"],
        "sla_level1": 2, "sla_level2": 3, "sla_level3": 5,
        "roles": ["manager", "developer"],
        "active_status": True,
    },
    {
        "stage_name": "Deployment",
        "description": "Production release, post-deployment validation and rollback readiness",
        "activity_names": ["Rollback Planning", "Production Deployment", "Smoke Testing"],
        "sla_level1": 1, "sla_level2": 2, "sla_level3": 3,
        "roles": ["developer", "operations_manager"],
        "active_status": True,
    },
    {
        "stage_name": "Closure",
        "description": "Documentation, knowledge transfer, handover and project retrospective",
        "activity_names": ["Documentation", "Project Handover", "Lessons Learned"],
        "sla_level1": 2, "sla_level2": 3, "sla_level3": 5,
        "roles": ["manager", "analyst"],
        "active_status": True,
    },
]


SAMPLE_CHAPTERS = [
    {
        "client": "Acme Corporation",      "project": "Enterprise ERP Integration Platform",
        "chapters": "CH-001",              "chapter_title": "Introduction and Scope",
        "project_manager_name": "john_doe","due_date": "2024-03-15",
        "stage_name": "Initiation",        "current_stage_activity": "Requirement Gathering",
        "current_assignee_name": "alice_johnson",
        "status": "In-progress",           "complexity_level": "High",
        "stage_level": 1,                  "workflow": "Agile Sprint",
        "published_status": "Draft",       "priority": "High",
        "remarks": "Initial chapter covering project objectives and scope definition.",
    },
    {
        "client": "Acme Corporation",      "project": "Enterprise ERP Integration Platform",
        "chapters": "CH-002",              "chapter_title": "System Architecture Design",
        "project_manager_name": "john_doe","due_date": "2024-04-10",
        "stage_name": "Design",            "current_stage_activity": "Database Design",
        "current_assignee_name": "jane_smith",
        "status": "In-progress",           "complexity_level": "High",
        "stage_level": 2,                  "workflow": "Agile Sprint",
        "published_status": "Draft",       "priority": "High",
        "remarks": None,
    },
    {
        "client": "Acme Corporation",      "project": "Cloud Infrastructure Migration Phase 2",
        "chapters": "CH-001",              "chapter_title": "Cloud Readiness Assessment",
        "project_manager_name": "charlie_brown", "due_date": "2024-05-01",
        "stage_name": "Planning",          "current_stage_activity": "Project Planning",
        "current_assignee_name": "evan_rogers",
        "status": "Hold",                  "complexity_level": "Medium",
        "stage_level": 1,                  "workflow": "DevOps Pipeline",
        "published_status": "Draft",       "priority": "Medium",
        "remarks": "On hold pending client infrastructure audit completion.",
    },
    {
        "client": "Beta Technologies",     "project": "Automated Deployment Pipeline Setup",
        "chapters": "CH-001",              "chapter_title": "CI/CD Tool Evaluation",
        "project_manager_name": "charlie_brown", "due_date": "2024-02-28",
        "stage_name": "Development",       "current_stage_activity": "Backend Development",
        "current_assignee_name": "evan_rogers",
        "status": "complete",              "complexity_level": "Medium",
        "stage_level": 3,                  "workflow": "CI/CD Workflow",
        "published_status": "Ready for Publish", "priority": "High",
        "remarks": None,
    },
    {
        "client": "Beta Technologies",     "project": "Automated Deployment Pipeline Setup",
        "chapters": "CH-002",              "chapter_title": "Pipeline Configuration and Testing",
        "project_manager_name": "charlie_brown", "due_date": "2024-03-20",
        "stage_name": "Testing",           "current_stage_activity": "Integration Testing",
        "current_assignee_name": "jane_smith",
        "status": "In-progress",           "complexity_level": "High",
        "stage_level": 4,                  "workflow": "CI/CD Workflow",
        "published_status": "Draft",       "priority": "High",
        "remarks": "Integration test cases being written for all deployment stages.",
    },
    {
        "client": "Gamma Retail Group",    "project": "Multi-Channel E-commerce Platform",
        "chapters": "CH-001",              "chapter_title": "Platform Requirements and User Stories",
        "project_manager_name": "john_doe","due_date": "2025-01-15",
        "stage_name": "Initiation",        "current_stage_activity": "Feasibility Study",
        "current_assignee_name": "bob_wilson",
        "status": "complete",              "complexity_level": "Low",
        "stage_level": 1,                  "workflow": "Retail Workflow",
        "published_status": "Published",   "priority": "High",
        "remarks": None,
    },
    {
        "client": "Gamma Retail Group",    "project": "Multi-Channel E-commerce Platform",
        "chapters": "CH-002",              "chapter_title": "Payment Gateway Integration",
        "project_manager_name": "john_doe","due_date": "2025-03-01",
        "stage_name": "Development",       "current_stage_activity": "Frontend Development",
        "current_assignee_name": "fiona_apple",
        "status": "In-progress",           "complexity_level": "High",
        "stage_level": 3,                  "workflow": "Retail Workflow",
        "published_status": "Draft",       "priority": "High",
        "remarks": "Payment gateway sandbox testing in parallel.",
    },
    {
        "client": "Delta Finance Ltd",     "project": "Core Banking System Modernisation",
        "chapters": "CH-001",              "chapter_title": "Legacy System Analysis",
        "project_manager_name": "george_martin", "due_date": "2024-06-30",
        "stage_name": "Review",            "current_stage_activity": "Code Review",
        "current_assignee_name": "bob_wilson",
        "status": "In-query",              "complexity_level": "High",
        "stage_level": 5,                  "workflow": "Banking Workflow",
        "published_status": "Draft",       "priority": "High",
        "remarks": "Client raised queries on data migration strategy for legacy accounts.",
    },
    {
        "client": "Epsilon Healthcare",    "project": "Hospital Management System Integration",
        "chapters": "CH-001",              "chapter_title": "HL7 FHIR Integration Design",
        "project_manager_name": "george_martin", "due_date": "2025-02-20",
        "stage_name": "Design",            "current_stage_activity": "UI Design",
        "current_assignee_name": "fiona_apple",
        "status": "In-progress",           "complexity_level": "High",
        "stage_level": 2,                  "workflow": "HMS Workflow",
        "published_status": "Draft",       "priority": "High",
        "remarks": None,
    },
    {
        "client": "Eta Media Group",       "project": "Streaming Platform Content Management System",
        "chapters": "CH-001",              "chapter_title": "Content Delivery Architecture",
        "project_manager_name": "john_doe","due_date": "2023-10-15",
        "stage_name": "Closure",           "current_stage_activity": "Project Handover",
        "current_assignee_name": "george_martin",
        "status": "complete",              "complexity_level": "Medium",
        "stage_level": 7,                  "workflow": "Content Workflow",
        "published_status": "Published",   "priority": "Low",
        "remarks": "Project completed and handed over to client operations team.",
    },
]


# ── Seed functions ────────────────────────────────────────────────────────────
def seed_roles(db):
    from sqlalchemy import select
    inserted = skipped = 0
    for data in SAMPLE_ROLES:
        exists = db.execute(
            select(RolesMaster).where(
                RolesMaster.role_name == data["role_name"],
                RolesMaster.team == data["team"],
            )
        ).scalars().first()
        label = f"{data['role_name']} @ {data['team']}"
        if exists:
            print(f"  SKIP  {label} (already exists)")
            skipped += 1
            continue
        db.add(RolesMaster(**data))
        try:
            db.commit()
            print(f"  OK    {label}")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {label} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed_users(db):
    from sqlalchemy import select
    inserted = skipped = 0
    for data in SAMPLE_USERS:
        # Validate role exists before inserting
        role = db.execute(
            select(RolesMaster).where(
                RolesMaster.role_name == data["role"],
                RolesMaster.team == data["team"],
                RolesMaster.active_status == True,  # noqa: E712
            )
        ).scalars().first()
        if not role:
            print(f"  ERROR {data['user_name']} — role '{data['role']}' in team '{data['team']}' not found in roles_master, skipping")
            skipped += 1
            continue
        exists = db.execute(select(User).where((User.user_name == data["user_name"]) | (User.email == data["email"]))).scalars().first()
        if exists:
            print(f"  SKIP  {data['user_name']} (already exists)")
            skipped += 1
            continue
        db.add(User(
            user_name=data["user_name"], email=data["email"],
            password=hash_pw(data["password"]), role=data["role"],
            team=data["team"], customer_access=data["customer_access"],
            active_status=data["active_status"],
        ))
        try:
            db.commit()
            print(f"  OK    {data['user_name']}")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {data['user_name']} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed_clients(db):
    from sqlalchemy import select
    # Resolve created_by to the admin user's id
    admin = db.execute(select(User).where(User.user_name == "admin_hema")).scalars().first()
    admin_id = admin.id if admin else None

    inserted = skipped = 0
    for data in SAMPLE_CLIENTS:
        label = data.get("name_company") or f"{data.get('first_name')} {data.get('surname')}"
        exists = db.execute(
            select(Client).where(Client.email == data["email"]) if data.get("email") else select(Client).where(False)
        ).scalars().first()
        if exists:
            print(f"  SKIP  {label} (already exists)")
            skipped += 1
            continue
        db.add(Client(**data, created_by=admin_id))
        try:
            db.commit()
            print(f"  OK    {label} [{data['category_type']}]")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {label} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed_stage_activities(db):
    from sqlalchemy import select
    inserted = skipped = 0
    for data in SAMPLE_STAGE_ACTIVITIES:
        exists = db.execute(select(StageActivityMaster).where(StageActivityMaster.stage_activity_name == data["stage_activity_name"])).scalars().first()
        if exists:
            print(f"  SKIP  {data['stage_activity_name']} (already exists)")
            skipped += 1
            continue
        db.add(StageActivityMaster(**data))
        try:
            db.commit()
            print(f"  OK    {data['stage_activity_name']}")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {data['stage_activity_name']} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed_stages(db):
    from sqlalchemy import select
    inserted = skipped = 0
    for data in SAMPLE_STAGES:
        exists = db.execute(select(StageMaster).where(StageMaster.stage_name == data["stage_name"])).scalars().first()
        if exists:
            print(f"  SKIP  {data['stage_name']} (already exists)")
            skipped += 1
            continue
        # Resolve activity names → IDs
        activity_ids = []
        for name in data["activity_names"]:
            act = db.execute(select(StageActivityMaster).where(StageActivityMaster.stage_activity_name == name)).scalars().first()
            if act:
                activity_ids.append(act.id)
            else:
                print(f"  WARN  activity '{name}' not found — skipped from {data['stage_name']}")
        db.add(StageMaster(
            stage_name=data["stage_name"],
            description=data["description"],
            stage_activities=activity_ids,
            sla_level1=data.get("sla_level1"),
            sla_level2=data.get("sla_level2"),
            sla_level3=data.get("sla_level3"),
            roles=data.get("roles", []),
            active_status=data["active_status"],
        ))
        try:
            db.commit()
            print(f"  OK    {data['stage_name']} (activities: {activity_ids})")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {data['stage_name']} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed_projects(db):
    from sqlalchemy import select
    inserted = skipped = 0
    for data in SAMPLE_PROJECTS:
        exists = db.execute(
            select(Project).where(Project.project_code == data["project_code"])
        ).scalars().first()
        if exists:
            print(f"  SKIP  {data['project_code']} (already exists)")
            skipped += 1
            continue
        # Resolve client_division → client_id
        client = db.execute(
            select(Client).where(Client.division == data["client_division"])
        ).scalars().first()
        client_id = client.id if client else None
        row = {k: v for k, v in data.items() if k != "client_division"}
        db.add(Project(**row, client_id=client_id))
        try:
            db.commit()
            print(f"  OK    {data['project_code']} — {data['project_title'][:50]}")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {data['project_code']} (integrity error)")
            skipped += 1
    return inserted, skipped


SAMPLE_STAGE_DETAILS = [
    # ── Acme Corp / ERP Integration / CH-001 ──────────────────────────────────
    {
        "client": "Acme Corporation",      "project": "Enterprise ERP Integration Platform",
        "chapters": "CH-001",              "project_manager_name": "john_doe",
        "assignee_name": "alice_johnson",  "start_date": "2024-01-10 09:00:00",
        "end_date": "2024-01-20 17:00:00", "stage_name": "Initiation",
        "stage_activity": "Requirement Gathering",
        "workflow": "Agile Sprint",        "complexity_level": "High",
        "stage_level": 1,                  "sla": 120,
        "stage_status": "complete",        "stage_activity_status": "complete",
        "remarks": "All functional requirements documented and signed off.",
    },
    {
        "client": "Acme Corporation",      "project": "Enterprise ERP Integration Platform",
        "chapters": "CH-001",              "project_manager_name": "john_doe",
        "assignee_name": "alice_johnson",  "start_date": "2024-01-21 09:00:00",
        "end_date": None,                  "stage_name": "Initiation",
        "stage_activity": "Feasibility Study",    
        "workflow": "Agile Sprint",        "complexity_level": "High",
        "stage_level": 1,                  "sla": 80,
        "stage_status": "In-progress",     "stage_activity_status": "In-progress",
        "remarks": None,
    },
    # ── Acme Corp / ERP Integration / CH-002 ──────────────────────────────────
    {
        "client": "Acme Corporation",      "project": "Enterprise ERP Integration Platform",
        "chapters": "CH-002",              "project_manager_name": "john_doe",
        "assignee_name": "jane_smith",     "start_date": "2024-02-01 09:00:00",
        "end_date": "2024-02-15 18:00:00", "stage_name": "Design",
        "stage_activity": "UI Design",
        "workflow": "Agile Sprint",        "complexity_level": "High",
        "stage_level": 2,                  "sla": 96,
        "stage_status": "complete",        "stage_activity_status": "complete",
        "remarks": None,
    },
    {
        "client": "Acme Corporation",      "project": "Enterprise ERP Integration Platform",
        "chapters": "CH-002",              "project_manager_name": "john_doe",
        "assignee_name": "jane_smith",     "start_date": "2024-02-16 09:00:00",
        "end_date": None,                  "stage_name": "Design",
        "stage_activity": "Database Design",      
        "workflow": "Agile Sprint",        "complexity_level": "High",
        "stage_level": 2,                  "sla": 72,
        "stage_status": "In-progress",     "stage_activity_status": "In-progress",
        "remarks": "Schema design in review with architect team.",
    },
    # ── Acme Corp / Cloud Migration / CH-001 ──────────────────────────────────
    {
        "client": "Acme Corporation",      "project": "Cloud Infrastructure Migration Phase 2",
        "chapters": "CH-001",              "project_manager_name": "charlie_brown",
        "assignee_name": "evan_rogers",    "start_date": "2024-03-01 09:00:00",
        "end_date": None,                  "stage_name": "Planning",
        "stage_activity": "Project Planning",     
        "workflow": "DevOps Pipeline",     "complexity_level": "Medium",
        "stage_level": 1,                  "sla": 48,
        "stage_status": "Hold",            "stage_activity_status": "Hold",
        "remarks": "On hold — awaiting client infrastructure audit report.",
    },
    # ── Beta Technologies / Deployment Pipeline / CH-001 ──────────────────────
    {
        "client": "Beta Technologies",     "project": "Automated Deployment Pipeline Setup",
        "chapters": "CH-001",              "project_manager_name": "charlie_brown",
        "assignee_name": "evan_rogers",    "start_date": "2024-01-05 08:00:00",
        "end_date": "2024-01-18 17:00:00", "stage_name": "Development",
        "stage_activity": "Backend Development",
        "workflow": "CI/CD Workflow",      "complexity_level": "Medium",
        "stage_level": 3,                  "sla": 160,
        "stage_status": "complete",        "stage_activity_status": "complete",
        "remarks": "Pipeline scripts written and unit tested.",
    },
    # ── Beta Technologies / Deployment Pipeline / CH-002 ──────────────────────
    {
        "client": "Beta Technologies",     "project": "Automated Deployment Pipeline Setup",
        "chapters": "CH-002",              "project_manager_name": "charlie_brown",
        "assignee_name": "jane_smith",     "start_date": "2024-02-10 08:00:00",
        "end_date": None,                  "stage_name": "Testing",
        "stage_activity": "Integration Testing",  
        "workflow": "CI/CD Workflow",      "complexity_level": "High",
        "stage_level": 4,                  "sla": 64,
        "stage_status": "In-progress",     "stage_activity_status": "In-progress",
        "remarks": None,
    },
    # ── Gamma Retail / E-commerce / CH-001 ────────────────────────────────────
    {
        "client": "Gamma Retail Group",    "project": "Multi-Channel E-commerce Platform",
        "chapters": "CH-001",              "project_manager_name": "john_doe",
        "assignee_name": "bob_wilson",     "start_date": "2024-11-01 10:00:00",
        "end_date": "2024-11-20 17:00:00", "stage_name": "Initiation",
        "stage_activity": "Feasibility Study",
        "workflow": "Retail Workflow",     "complexity_level": "Low",
        "stage_level": 1,                  "sla": 56,
        "stage_status": "complete",        "stage_activity_status": "complete",
        "remarks": None,
    },
    # ── Gamma Retail / E-commerce / CH-002 ────────────────────────────────────
    {
        "client": "Gamma Retail Group",    "project": "Multi-Channel E-commerce Platform",
        "chapters": "CH-002",              "project_manager_name": "john_doe",
        "assignee_name": "fiona_apple",    "start_date": "2025-01-10 10:00:00",
        "end_date": None,                  "stage_name": "Development",
        "stage_activity": "Frontend Development", 
        "workflow": "Retail Workflow",     "complexity_level": "High",
        "stage_level": 3,                  "sla": 120,
        "stage_status": "In-progress",     "stage_activity_status": "In-progress",
        "remarks": "Payment UI components 60% complete.",
    },
    # ── Delta Finance / Core Banking / CH-001 ─────────────────────────────────
    {
        "client": "Delta Finance Ltd",     "project": "Core Banking System Modernisation",
        "chapters": "CH-001",              "project_manager_name": "george_martin",
        "assignee_name": "bob_wilson",     "start_date": "2024-04-01 08:00:00",
        "end_date": None,                  "stage_name": "Review",
        "stage_activity": "Code Review",          
        "workflow": "Banking Workflow",    "complexity_level": "High",
        "stage_level": 5,                  "sla": 48,
        "stage_status": "In-query",        "stage_activity_status": "In-query",
        "remarks": "Client raised queries on data migration strategy for legacy accounts.",
    },
    # ── Epsilon Healthcare / HMS / CH-001 ─────────────────────────────────────
    {
        "client": "Epsilon Healthcare",    "project": "Hospital Management System Integration",
        "chapters": "CH-001",              "project_manager_name": "george_martin",
        "assignee_name": "fiona_apple",    "start_date": "2025-01-15 07:00:00",
        "end_date": None,                  "stage_name": "Design",
        "stage_activity": "UI Design",            
        "workflow": "HMS Workflow",        "complexity_level": "High",
        "stage_level": 2,                  "sla": 96,
        "stage_status": "In-progress",     "stage_activity_status": "In-progress",
        "remarks": None,
    },
    # ── Eta Media / CMS / CH-001 ──────────────────────────────────────────────
    {
        "client": "Eta Media Group",       "project": "Streaming Platform Content Management System",
        "chapters": "CH-001",              "project_manager_name": "john_doe",
        "assignee_name": "george_martin",  "start_date": "2023-09-01 10:00:00",
        "end_date": "2023-10-10 16:00:00", "stage_name": "Closure",
        "stage_activity": "Project Handover",
        "workflow": "Content Workflow",    "complexity_level": "Medium",
        "stage_level": 7,                  "sla": 40,
        "stage_status": "complete",        "stage_activity_status": "complete",
        "remarks": "All deliverables handed over. Client sign-off received.",
    },
]


def seed_chapters(db):
    from sqlalchemy import select
    inserted = skipped = 0
    for data in SAMPLE_CHAPTERS:
        exists = db.execute(
            select(ChapterInfo).where(
                ChapterInfo.project  == data["project"],
                ChapterInfo.chapters == data["chapters"],
            )
        ).scalars().first()
        if exists:
            print(f"  SKIP  {data['project']} / {data['chapters']} (already exists)")
            skipped += 1
            continue
        db.add(ChapterInfo(**data))
        try:
            db.commit()
            print(f"  OK    {data['chapters']} — {data['chapter_title']}")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {data['project']} / {data['chapters']} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed_stage_details(db):
    from sqlalchemy import select
    from datetime import datetime as dt
    inserted = skipped = 0
    for data in SAMPLE_STAGE_DETAILS:
        exists = db.execute(
            select(StageDetail).where(
                StageDetail.project        == data["project"],
                StageDetail.chapters       == data["chapters"],
                StageDetail.stage_activity == data["stage_activity"],
            )
        ).scalars().first()
        if exists:
            print(f"  SKIP  {data['chapters']} / {data['stage_activity']} (already exists)")
            skipped += 1
            continue
        row = dict(data)
        start = dt.fromisoformat(row["start_date"]) if row.get("start_date") else None
        end   = dt.fromisoformat(row["end_date"])   if row.get("end_date")   else None
        row["total_time_taken"] = round((end - start).total_seconds() / 3600, 2) if start and end else None
        db.add(StageDetail(**row))
        try:
            db.commit()
            print(f"  OK    {data['chapters']} — {data['stage_name']} / {data['stage_activity']}")
            inserted += 1
        except IntegrityError:
            db.rollback()
            print(f"  SKIP  {data['chapters']} / {data['stage_activity']} (integrity error)")
            skipped += 1
    return inserted, skipped


def seed():
    create_tables()
    db = SessionLocal()
    try:
        print("-- roles_master -----------------------------------------")
        ri, rs = seed_roles(db)

        print("\n-- users ------------------------------------------------")
        ui, us = seed_users(db)

        print("\n-- clients ----------------------------------------------")
        ci, cs = seed_clients(db)

        print("\n-- stage_activity_master --------------------------------")
        ai, as_ = seed_stage_activities(db)

        print("\n-- stage_master -----------------------------------------")
        si, ss = seed_stages(db)

        print("\n-- projects ---------------------------------------------")
        pi, ps = seed_projects(db)

        print("\n-- chapter_details --------------------------------------")
        chi, chs = seed_chapters(db)

        print("\n-- stages_details ---------------------------------------")
        sdi, sds = seed_stage_details(db)

        print(
            f"\nDone -- "
            f"roles: {ri}/{rs}  |  users: {ui}/{us}  |  clients: {ci}/{cs}  |  "
            f"activities: {ai}/{as_}  |  stages: {si}/{ss}  |  projects: {pi}/{ps}  |  "
            f"chapters: {chi}/{chs}  |  stage details: {sdi}/{sds}  "
            f"(inserted/skipped)"
        )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
