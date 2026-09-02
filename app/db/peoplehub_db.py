import logging
from typing import Optional, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_peoplehub_engine = None
_PeopleHubSessionLocal = None

def get_peoplehub_engine():
    global _peoplehub_engine
    if _peoplehub_engine is None:
        db_url = getattr(settings, "PEOPLEHUB_DATABASE_URL", None)
        
        candidates = []
        if db_url:
            candidates.append(db_url)
            if "vBr" in db_url and "%24" not in db_url:
                candidates.append(db_url.replace("vBr", "%24vBr").replace("172.17.0.1", "10.1.1.18").replace("peoplehub_postgres:5432", "10.1.1.18:5435"))
                candidates.append(db_url.replace("vBr", "%24%24vBr").replace("172.17.0.1", "10.1.1.18").replace("peoplehub_postgres:5432", "10.1.1.18:5435"))

        candidates.extend([
            "postgresql://postgres:%24vBr%402150@10.1.1.18:5435/peoplehub_db",
            "postgresql://postgres:%24%24vBr%402150@10.1.1.18:5435/peoplehub_db",
            "postgresql://postgres:vBr%402150@10.1.1.18:5435/peoplehub_db",
            "postgresql://postgres:%24vBr%402150@peoplehub_postgres:5432/peoplehub_db",
        ])

        last_error = None
        for candidate_url in candidates:
            try:
                engine = create_engine(
                    candidate_url,
                    pool_pre_ping=True,
                    execution_options={"read_only": True}
                )
                with engine.connect() as conn:
                    pass
                _peoplehub_engine = engine
                return _peoplehub_engine
            except Exception as exc:
                last_error = exc
                continue

        logger.error(f"Failed all candidate PeopleHub DB connections. Last error: {last_error}")
        _peoplehub_engine = create_engine(
            candidates[0],
            pool_pre_ping=True,
            execution_options={"read_only": True}
        )
    return _peoplehub_engine

def get_peoplehub_session():
    global _PeopleHubSessionLocal
    if _PeopleHubSessionLocal is None:
        engine = get_peoplehub_engine()
        _PeopleHubSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return _PeopleHubSessionLocal()

def find_peoplehub_user(identifier: str) -> Optional[Dict[str, Any]]:
    """
    Search PeopleHub DB for a user by employee_id or company_email ONLY.
    Strictly READ-ONLY query.
    Returns a dictionary containing user details, employee_id, role_name, and password_hash.
    """
    if not identifier:
        return None
    
    clean_id = identifier.strip()
    
    # Query matching employee_id or company_email
    query = text("""
        SELECT 
            u.id AS user_id,
            u.full_name,
            u.email,
            u.company_email,
            u.password_hash,
            u.status,
            u.is_active,
            r.name AS role_name,
            e.employee_id,
            e.department,
            e.designation,
            e.first_name,
            e.last_name
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN employees e ON e.user_id = u.id
        WHERE LOWER(e.employee_id) = LOWER(:identifier)
           OR LOWER(u.company_email) = LOWER(:identifier)
        LIMIT 1
    """)
    
    session = get_peoplehub_session()
    try:
        result = session.execute(query, {"identifier": clean_id}).fetchone()
        if not result:
            return None
        
        row = dict(result._mapping)
        # Fallback for employee_id if missing: use user_id or email prefix
        emp_id = row.get("employee_id") or (clean_id if not "@" in clean_id else clean_id.split("@")[0])
        role_name = row.get("role_name") or "Employee"
        
        email_val = row.get("company_email") or row.get("email")
        
        full_n = row.get("full_name") or ""
        fn = row.get("first_name") or (full_n.split()[0] if full_n else "")
        ln = row.get("last_name") or (" ".join(full_n.split()[1:]) if full_n and " " in full_n else "")

        return {
            "user_id": row["user_id"],
            "employee_id": emp_id,
            "first_name": fn,
            "last_name": ln,
            "full_name": full_n or f"{fn} {ln}".strip(),
            "email": email_val,
            "company_email": row.get("company_email"),
            "password_hash": row["password_hash"],
            "role": role_name, # Preserves exact PeopleHub role (Admin, Manager, Employee, etc.)
            "department": row.get("department"),
            "designation": row.get("designation"),
            "is_active": bool(row.get("is_active", True) and row.get("status", "active") != "inactive")
        }
    except Exception as exc:
        logger.warning(f"Error querying PeopleHub database: {exc}")
        return None
    finally:
        session.close()

def get_all_peoplehub_users() -> list[dict]:
    query = text("""
        SELECT 
            u.id AS user_id,
            u.full_name,
            u.email,
            u.company_email,
            u.password_hash,
            u.status,
            u.is_active,
            r.name AS role_name,
            e.employee_id,
            e.department,
            e.designation,
            e.first_name,
            e.last_name
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN employees e ON e.user_id = u.id
    """)
    session = get_peoplehub_session()
    try:
        results = session.execute(query).fetchall()
        users_list = []
        for result in results:
            row = dict(result._mapping)
            emp_id = row.get("employee_id") or (str(row.get("user_id")) if row.get("user_id") else None)
            if not emp_id:
                continue
            role_name = row.get("role_name") or "Employee"
            email_val = row.get("company_email") or row.get("email") or f"{emp_id}@s4carlisle.com"
            full_n = row.get("full_name") or ""
            fn = row.get("first_name") or (full_n.split()[0] if full_n else "")
            ln = row.get("last_name") or (" ".join(full_n.split()[1:]) if full_n and " " in full_n else "")
            users_list.append({
                "user_id": row.get("user_id"),
                "employee_id": str(emp_id),
                "full_name": full_n,
                "first_name": fn,
                "last_name": ln,
                "email": email_val,
                "company_email": row.get("company_email"),
                "password_hash": row.get("password_hash"),
                "role": role_name,
                "department": row.get("department"),
                "designation": row.get("designation"),
                "is_active": bool(row.get("is_active", True) and row.get("status", "active") != "inactive")
            })
        return users_list
    except Exception as exc:
        logger.warning(f"Error querying all PeopleHub users: {exc}")
        return []
    finally:
        session.close()
