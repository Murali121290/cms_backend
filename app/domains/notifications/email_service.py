import smtplib
import socket
import struct
import ssl
from email.message import EmailMessage
from typing import Optional
import logging
from app.core.config import get_settings

logger = logging.getLogger(__name__)


def resolve_hostname_fallback(hostname: str) -> str:
    """
    Attempts standard socket resolution first.
    If DNS resolution fails (e.g. Errno -5 in Docker where 127.0.0.11 fails to route external queries),
    queries fallback DNS servers directly over UDP port 53.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
        if infos:
            return hostname
    except Exception:
        pass

    dns_servers = ['10.1.1.65', '10.1.1.17', '8.8.8.8', '1.1.1.1']
    for dns_ip in dns_servers:
        try:
            tid = 0x1234
            flags = 0x0100
            packet = struct.pack('!HHHHHH', tid, flags, 1, 0, 0, 0)
            qname = b''.join(bytes([len(p)]) + p.encode('ascii') for p in hostname.split('.')) + bytes([0])
            packet += qname + struct.pack('!HH', 1, 1)
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(2.0)
            sock.sendto(packet, (dns_ip, 53))
            data, _ = sock.recvfrom(1024)
            sock.close()
            ancount = struct.unpack('!H', data[6:8])[0]
            offset = 12 + len(qname) + 4
            for _ in range(ancount):
                if offset >= len(data):
                    break
                if data[offset] & 0xc0 == 0xc0:
                    offset += 2
                else:
                    while offset < len(data) and data[offset] != 0:
                        offset += 1 + data[offset]
                    offset += 1
                atype, aclass, ttl, rdlength = struct.unpack('!HHIH', data[offset:offset+10])
                offset += 10
                if atype == 1 and rdlength == 4:
                    resolved_ip = socket.inet_ntoa(data[offset:offset+4])
                    logger.info("Resolved %s -> %s via fallback DNS %s", hostname, resolved_ip, dns_ip)
                    return resolved_ip
                offset += rdlength
        except Exception:
            continue
    return hostname


def get_smtp_client():
    """
    Constructs an authenticated SMTP / SMTP_SSL client with DNS fallback resilience.
    """
    settings = get_settings()
    raw_host = getattr(settings, 'SMTP_HOST', 'localhost')
    target_host = resolve_hostname_fallback(raw_host)
    port = int(getattr(settings, 'SMTP_PORT', 25))
    use_ssl = getattr(settings, 'SMTP_USE_SSL', False)
    use_tls = getattr(settings, 'SMTP_USE_TLS', False)
    smtp_user = getattr(settings, 'SMTP_USERNAME', None)
    smtp_pass = getattr(settings, 'SMTP_PASSWORD', None)

    if use_ssl:
        server = smtplib.SMTP_SSL(target_host, port, timeout=15)
    else:
        server = smtplib.SMTP(target_host, port, timeout=15)

    server._host = raw_host
    server.ehlo(raw_host)

    if not use_ssl and use_tls:
        context = ssl.create_default_context()
        server.starttls(context=context)
        server.ehlo(raw_host)

    if smtp_user and smtp_pass:
        server.login(smtp_user, smtp_pass)

    return server


def send_email(to_email: str, subject: str, text_body: str, html_body: str = None, cc_emails: Optional[list] = None):
    settings = get_settings()
    smtp_from = getattr(settings, 'SMTP_FROM', 'noreply@example.com')
    smtp_user = getattr(settings, 'SMTP_USERNAME', None)

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = smtp_from
    msg['To'] = to_email
    if cc_emails:
        msg['Cc'] = ", ".join(cc_emails) if isinstance(cc_emails, (list, tuple)) else str(cc_emails)

    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype='html')

    to_list = [e.strip() for e in to_email.split(',') if e.strip()] if isinstance(to_email, str) else list(to_email)
    cc_list = [e.strip() for e in (cc_emails if isinstance(cc_emails, (list, tuple)) else str(cc_emails).split(','))] if cc_emails else []
    all_recipients = to_list + cc_list

    try:
        server = get_smtp_client()
        with server:
            server.send_message(msg, to_addrs=all_recipients)
        logger.info(f"Sent email to {to_email} (cc: {cc_emails}) with subject: {subject}")
        print(f"SUCCESS: Sent email to {to_email} (cc: {cc_emails}) with subject: {subject}")
    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP Authentication failed for {smtp_user}: {str(e)}. Check credentials or use App Password for Office 365.")
        print(f"FAILED: Authentication error. For Office 365, use an App Password instead of regular password.")
    except smtplib.SMTPException as e:
        logger.error(f"SMTP error sending to {to_email}: {str(e)}")
        print(f"FAILED to send email to {to_email}. SMTP Error: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {str(e)}")
        print(f"FAILED to send email to {to_email}. Error: {str(e)}")


def send_bod_new_job_email(manager_email: str, project_name: str, pdf_filename: str, cover_filename: str = None):
    subject = f"Books on Demand - Action Required: New Project Ingested [{project_name}]"
    
    cover_line_txt = f"\n- Cover Image: {cover_filename}" if cover_filename else ""
    cover_line_html = f'<p style="margin: 5px 0 0 0;"><strong>Cover Image:</strong> {cover_filename}</p>' if cover_filename else ''

    text_body = f"""Hello,

A new Books on Demand project has been successfully ingested into the system and requires assignment.

Project Details:
- Project Name: {project_name}
- Source File: {pdf_filename}{cover_line_txt}

Please log in to Inkflow to assign this project to a team member to begin the Production stage.

Best regards,
S4Carlisle Inkflow Automated System
"""

    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">New Project Assignment Required</h2>
        <p>Hello,</p>
        <p>A new Books on Demand project has been successfully ingested into the system and requires assignment.</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #0056b3; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>Project Name:</strong> {project_name}</p>
            <p style="margin: 0 0 8px 0;"><strong>Source File:</strong> {pdf_filename}</p>
            {cover_line_html}
        </div>
        
        <p>Please log in to Inkflow to assign this project to a team member so they can begin the Production stage.</p>
        
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #777; margin: 0;">Best regards,<br><strong>S4Carlisle Inkflow Automated System</strong></p>
      </body>
    </html>
    """
    send_email(manager_email, subject, text_body, html_body)


def send_bod_qc_ready_email(manager_email: str, project_name: str, epub_filename: str):
    subject = f"Books on Demand - Action Required: Project Ready for QC [{project_name}]"
    
    text_body = f"""Hello,

The Production stage for the following Books on Demand project has been completed. The generated EPUB is now ready for Quality Control (QC).

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
        <p>The Production stage for the following Books on Demand project has been completed. The generated EPUB is now ready for Quality Control (QC).</p>
        
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
    subject = f"Books on Demand - Project Completed [{project_name}]"
    
    text_body = f"""Hello,

The Books on Demand project has successfully passed Quality Control (QC) and is now marked as Completed (Archived). The final EPUB has been scheduled for FTP delivery.

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
        <p>The Books on Demand project has successfully passed Quality Control (QC) and is now marked as Completed (Archived). The final EPUB has been scheduled for FTP delivery.</p>
        
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


def send_bod_ready_to_dispatch_email(manager_email: str, project_name: str, epub_filename: str):
    subject = f"Books on Demand - Ready to Dispatch [{project_name}]"
    
    text_body = f"""Hello,

The Books on Demand project has completed Quality Control (QC) and is now moved to Ready to Dispatch.

Project Details:
- Project Name: {project_name}
- EPUB File: {epub_filename}

This job has been automatically assigned to you for final package inspection and FTP dispatch.

Best regards,
S4Carlisle Inkflow Automated System
"""

    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Project Ready to Dispatch</h2>
        <p>Hello,</p>
        <p>The Books on Demand project has completed Quality Control (QC) and has moved to <strong>Ready to Dispatch</strong>.</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Project Name:</strong> {project_name}</p>
            <p style="margin: 0;"><strong>EPUB File:</strong> {epub_filename}</p>
        </div>
        
        <p>This job has been automatically assigned to you for final package inspection and FTP dispatch.</p>
        
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #777; margin: 0;">Best regards,<br><strong>S4Carlisle Inkflow Automated System</strong></p>
      </body>
    </html>
    """
    send_email(manager_email, subject, text_body, html_body)



def send_bod_fastrack_alert_email(
    manager_email: str,
    project_name: str,
    pdf_filename: str,
    expected_date: str,
    due_date: Optional[str] = None
):
    subject = f"Books on Demand - Action Required: Project Marked as Fastrack [{project_name or pdf_filename}]"
    
    text_body = f"""Hello,

The customer has enabled Fastrack priority for the following Books on Demand project.

Project Details:
- Project Name: {project_name or '-'}
- Source PDF: {pdf_filename}
- Fastrack Requested Date: {expected_date}
- Due Date: {due_date or 'Not specified'}

Please prioritize production and QC to meet the customer's expected date.

Best regards,
S4Carlisle Inkflow Automated System
"""

    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Project Marked as Fastrack</h2>
        <p>Hello,</p>
        <p>The customer has enabled <strong>Fastrack</strong> priority for the following Books on Demand project.</p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Project Name:</strong> {project_name or '-'}</p>
            <p style="margin: 0 0 10px 0;"><strong>Source PDF:</strong> {pdf_filename}</p>
            <p style="margin: 0 0 10px 0; color: #b45309;"><strong>Fastrack Requested Date:</strong> {expected_date}</p>
            <p style="margin: 0;"><strong>Due Date:</strong> {due_date or 'Not specified'}</p>
        </div>
        
        <p>Please review the job on the Inkflow BOD dashboard and coordinate with the team to meet the requested timeline.</p>
        
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #777; margin: 0;">Best regards,<br><strong>S4Carlisle Inkflow Automated System</strong></p>
      </body>
    </html>
    """
    send_email(manager_email, subject, text_body, html_body)

