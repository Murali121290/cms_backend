import smtplib
from email.message import EmailMessage
import logging
from app.core.config import get_settings

logger = logging.getLogger(__name__)

def send_email(to_email: str, subject: str, text_body: str, html_body: str = None):
    settings = get_settings()
    
    smtp_host = getattr(settings, "SMTP_HOST", "localhost")
    smtp_port = int(getattr(settings, "SMTP_PORT", 25))
    smtp_user = getattr(settings, "SMTP_USERNAME", None)
    smtp_pass = getattr(settings, "SMTP_PASSWORD", None)
    smtp_from = getattr(settings, "SMTP_FROM", "noreply@example.com")
    
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = smtp_from
    msg['To'] = to_email
    
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype='html')

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            if getattr(settings, "SMTP_USE_TLS", False):
                server.starttls()
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        logger.info(f"Sent email to {to_email} with subject: {subject}")
        print(f"SUCCESS: Sent email to {to_email} with subject: {subject}")
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {str(e)}")
        print(f"FAILED to send email to {to_email}. Error: {str(e)}")


def send_bod_new_job_email(manager_email: str, project_name: str, pdf_filename: str):
    subject = f"Action Required: New Book on Demand Project [{project_name}]"
    
    text_body = f"""Hello,

A new Book on Demand project has been successfully ingested into the system and requires assignment.

Project Details:
- Project Name: {project_name}
- Source File: {pdf_filename}

Please log in to Inkflow to assign this project to a team member to begin the Production stage.

Best regards,
S4Carlisle Inkflow Automated System
"""

    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">New Project Assignment Required</h2>
        <p>Hello,</p>
        <p>A new Book on Demand project has been successfully ingested into the system and requires assignment.</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #0056b3; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Project Name:</strong> {project_name}</p>
            <p style="margin: 0;"><strong>Source File:</strong> {pdf_filename}</p>
        </div>
        
        <p>Please log in to Inkflow to assign this project to a team member so they can begin the Production stage.</p>
        
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #777; margin: 0;">Best regards,<br><strong>S4Carlisle Inkflow Automated System</strong></p>
      </body>
    </html>
    """
    send_email(manager_email, subject, text_body, html_body)


def send_bod_qc_ready_email(manager_email: str, project_name: str, epub_filename: str):
    subject = f"Action Required: Book on Demand Project Ready for QC [{project_name}]"
    
    text_body = f"""Hello,

The Production stage for the following Book on Demand project has been completed. The generated EPUB is now ready for Quality Control (QC).

Project Details:
- Project Name: {project_name}
- EPUB File: {epub_filename}

Please log in to Inkflow to assign this project to a QC specialist.

Best regards,
S4Carlisle Inkflow Automated System
"""

    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Project Ready for QC</h2>
        <p>Hello,</p>
        <p>The Production stage for the following Book on Demand project has been completed. The generated EPUB is now ready for Quality Control (QC).</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Project Name:</strong> {project_name}</p>
            <p style="margin: 0;"><strong>EPUB File:</strong> {epub_filename}</p>
        </div>
        
        <p>Please log in to Inkflow to assign this project to a QC specialist.</p>
        
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #777; margin: 0;">Best regards,<br><strong>S4Carlisle Inkflow Automated System</strong></p>
      </body>
    </html>
    """
    send_email(manager_email, subject, text_body, html_body)


def send_bod_job_completed_email(manager_email: str, project_name: str, epub_filename: str):
    subject = f"Book on Demand Project Completed [{project_name}]"
    
    text_body = f"""Hello,

The Book on Demand project has successfully passed Quality Control (QC) and is now marked as Completed (Archived). The final EPUB has been scheduled for FTP delivery.

Project Details:
- Project Name: {project_name}
- EPUB File: {epub_filename}

No further action is required for this project in Inkflow.

Best regards,
S4Carlisle Inkflow Automated System
"""

    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Project Completed</h2>
        <p>Hello,</p>
        <p>The Book on Demand project has successfully passed Quality Control (QC) and is now marked as Completed (Archived). The final EPUB has been scheduled for FTP delivery.</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Project Name:</strong> {project_name}</p>
            <p style="margin: 0;"><strong>EPUB File:</strong> {epub_filename}</p>
        </div>
        
        <p>No further action is required for this project in Inkflow.</p>
        
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #777; margin: 0;">Best regards,<br><strong>S4Carlisle Inkflow Automated System</strong></p>
      </body>
    </html>
    """
    send_email(manager_email, subject, text_body, html_body)
