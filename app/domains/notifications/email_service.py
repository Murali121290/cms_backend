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


def send_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str = None,
    cc_emails: Optional[list] = None,
    attachments: Optional[list[dict]] = None
):
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

    if attachments:
        for att in attachments:
            content = att.get('content')
            filename = att.get('filename', 'attachment')
            maintype = att.get('maintype', 'application')
            subtype = att.get('subtype', 'octet-stream')
            if content:
                msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

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


def send_bod_daily_receipt_summary_email(
    manager_email: str,
    report_date_str: str,
    summary_rows: list[dict]
):
    """
    Sends the daily BOD Job Receipt Summary email (e.g. at 6:30 PM).
    Columns:
    S. No. | Date | ISBN | Title Name | Pages | Input Type | Cover | Language | File Size (KB) | Alt Text Available? | Remarks
    """
    subject = f"BOD JOB RECEIPT SUMMARY - {report_date_str}"

    text_rows = []
    text_rows.append(f"BOD JOB RECEIPT SUMMARY - Report Generated: {report_date_str}\n")
    text_rows.append("S. No. | Date | ISBN | Title Name | Pages | Input Type | Cover | Language | File Size (KB) | Alt Text Available? | Remarks")
    text_rows.append("-" * 135)

    html_table_rows = ""
    for idx, r in enumerate(summary_rows, start=1):
        s_no = idx
        row_date = r.get("date") or report_date_str
        isbn_val = r.get("isbn") or r.get("pisbn") or "-"
        title = r.get("title") or "-"
        pages = r.get("pages") or "-"
        input_type = r.get("input_type") or "-"
        cover = r.get("cover") or "-"
        language = r.get("language") or "-"
        file_size_kb = r.get("file_size_kb") or "-"
        alt_text = r.get("alt_text") or "No"
        remarks = r.get("remarks") or "-"

        remarks_lower = remarks.lower()
        if "not received" in remarks_lower:
            badge_style = "background-color: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;"
        elif "cover missing" in remarks_lower:
            badge_style = "background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;"
        elif "and cover received" in remarks_lower:
            badge_style = "background-color: #d1fae5; color: #065f46; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;"
        elif "not in csv" in remarks_lower:
            badge_style = "background-color: #e0e7ff; color: #3730a3; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;"
        else:
            badge_style = "background-color: #f3f4f6; color: #374151; padding: 3px 8px; border-radius: 4px; font-size: 11px;"

        row_bg = "#ffffff" if idx % 2 != 0 else "#f9fafb"

        text_rows.append(
            f"{s_no} | {row_date} | {isbn_val} | {title} | {pages} | {input_type} | {cover} | {language} | {file_size_kb} | {alt_text} | {remarks}"
        )

        html_table_rows += f"""
        <tr style="background-color: {row_bg}; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: #4b5563;">{s_no}</td>
          <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: #4b5563; white-space: nowrap;">{row_date}</td>
          <td style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #111827;">{isbn_val}</td>
          <td style="padding: 10px 12px; font-size: 12px; color: #1f2937;">{title}</td>
          <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: #4b5563;">{pages}</td>
          <td style="padding: 10px 12px; font-size: 12px; color: #4b5563;">{input_type}</td>
          <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: #4b5563;">{cover}</td>
          <td style="padding: 10px 12px; font-size: 12px; color: #4b5563;">{language}</td>
          <td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #4b5563;">{file_size_kb}</td>
          <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: #4b5563;">{alt_text}</td>
          <td style="padding: 10px 12px; font-size: 12px;"><span style="{badge_style}">{remarks}</span></td>
        </tr>
        """

    if not summary_rows:
        text_rows.append("No files or CSV entries to report.")
        html_table_rows = """
        <tr>
          <td colspan="11" style="padding: 20px; text-align: center; color: #6b7280; font-size: 13px;">No files or CSV entries to report.</td>
        </tr>
        """

    text_body = "\n".join(text_rows) + "\n\nBest regards,\nS4Carlisle Inkflow Automated System"

    html_body = f"""
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background-color: #f3f4f6; }}
          .container {{ max-width: 1100px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e5e7eb; }}
          .header {{ background: #1e3a8a; color: #ffffff; padding: 20px 28px; }}
          .header h1 {{ margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }}
          .header p {{ margin: 4px 0 0 0; font-size: 13px; color: #bfdbfe; }}
          .table-wrapper {{ overflow-x: auto; padding: 20px 24px; }}
          table {{ width: 100%; border-collapse: collapse; text-align: left; }}
          th {{ background-color: #f8fafc; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px; border-bottom: 2px solid #e2e8f0; }}
          .footer {{ padding: 16px 28px; background: #f8fafc; border-top: 1px solid #e5e7eb; font-size: 12px; color: #64748b; text-align: right; }}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <table style="width: 100%; border: none;">
              <tr>
                <td style="border: none; padding: 0;">
                  <h1 style="color: #ffffff;">BOD JOB RECEIPT SUMMARY</h1>
                  <p>Daily report of received files, covers, and CSV manifest reconciliation</p>
                </td>
                <td style="border: none; padding: 0; text-align: right; vertical-align: middle;">
                  <span style="background: rgba(255,255,255,0.2); padding: 6px 12px; border-radius: 4px; font-size: 13px; font-weight: 600;">Date: {report_date_str}</span>
                </td>
              </tr>
            </table>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style="text-align: center;">S. No.</th>
                  <th style="text-align: center;">Date</th>
                  <th>ISBN</th>
                  <th>Title Name</th>
                  <th style="text-align: center;">Pages</th>
                  <th>Input Type</th>
                  <th style="text-align: center;">Cover</th>
                  <th>Language</th>
                  <th style="text-align: right;">File Size (KB)</th>
                  <th style="text-align: center;">Alt Text?</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {html_table_rows}
              </tbody>
            </table>
          </div>
          <div class="footer">
            Generated automatically by <strong>S4Carlisle Inkflow Automated System</strong>
          </div>
        </div>
      </body>
    </html>
    """

    # Generate Excel (.xlsx) file attachment from summary_rows
    attachments = []
    try:
        import io
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "BOD Job Receipt Summary"

        # Headers
        headers = [
            "S. No.", "Date", "ISBN", "Title Name", "Pages", "Input Type",
            "Cover", "Language", "File Size (KB)", "Alt Text Available?", "Remarks"
        ]
        ws.append(headers)

        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        thin_border = Border(
            left=Side(style='thin', color='E5E7EB'),
            right=Side(style='thin', color='E5E7EB'),
            top=Side(style='thin', color='E5E7EB'),
            bottom=Side(style='thin', color='E5E7EB')
        )

        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_num)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        # Data rows
        for idx, r in enumerate(summary_rows, start=1):
            row_data = [
                idx,
                r.get("date") or report_date_str,
                r.get("isbn") or r.get("pisbn") or "-",
                r.get("title") or "-",
                r.get("pages") or "-",
                r.get("input_type") or "-",
                r.get("cover") or "-",
                r.get("language") or "-",
                r.get("file_size_kb") or "-",
                r.get("alt_text") or "No",
                r.get("remarks") or "-"
            ]
            ws.append(row_data)

            current_row = idx + 1
            for col_num in range(1, len(row_data) + 1):
                cell = ws.cell(row=current_row, column=col_num)
                cell.border = thin_border
                cell.font = Font(name="Calibri", size=10)
                if col_num in (1, 2, 5, 7, 10):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                elif col_num == 9:
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="left", vertical="center")

        # Auto-adjust column widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        excel_buffer = io.BytesIO()
        wb.save(excel_buffer)
        excel_bytes = excel_buffer.getvalue()

        # Sanitize report date for filename
        clean_date = report_date_str.replace('/', '-')
        excel_filename = f"BOD_Job_Receipt_Summary_{clean_date}.xlsx"

        attachments.append({
            "content": excel_bytes,
            "filename": excel_filename,
            "maintype": "application",
            "subtype": "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        })
    except Exception as exc:
        logger.error(f"Failed to generate Excel attachment for BOD daily receipt summary: {exc}")

    send_email(manager_email, subject, text_body, html_body, attachments=attachments)

