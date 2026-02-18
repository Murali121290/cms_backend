
import os
import sys

# Add project root to sys.path
sys.path.append(os.getcwd())

from app import models, database

def debug_file():
    db = database.SessionLocal()
    try:
        file_id = 53
        print(f"Checking File ID: {file_id}")
        
        file_record = db.query(models.File).filter(models.File.id == file_id).first()
        if not file_record:
            print("ERROR: File record not found in DB!")
            return
            
        print(f"Found Record: ID={file_record.id}")
        print(f"Filename: {file_record.filename}")
        print(f"Stored Path: {file_record.path}")
        
        abs_path = os.path.abspath(file_record.path)
        print(f"Absolute Path: {abs_path}")
        
        if os.path.exists(abs_path):
            print("SUCCESS: Physical file exits.")
        else:
            print("ERROR: Physical file MISSING!")
            
    except Exception as e:
        print(f"Exception: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    debug_file()
