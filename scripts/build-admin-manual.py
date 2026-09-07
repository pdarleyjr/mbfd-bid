"""Generate the downloadable administrator PDF from the live Docs source.

Requires Node 22+ and ReportLab. Run after formatting guide-content.ts.
The committed manifest lets the unit suite detect a stale PDF after guide edits.
"""
import hashlib
import json
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'apps/web/app/admin/guide/guide-content.ts'
OUTPUT = ROOT / 'apps/web/public/manual/MBFD-Bid-Administrator-Manual.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sections = json.loads(subprocess.check_output(
    ['node', '--experimental-strip-types', str(ROOT / 'scripts/export-admin-guide.mjs')],
    cwd=ROOT, text=True, encoding='utf-8',
))
font_paths = [Path('C:/Windows/Fonts'), Path('/usr/share/fonts/truetype/dejavu')]
for folder in font_paths:
    normal, bold = (folder / 'arial.ttf', folder / 'arialbd.ttf') if folder.drive else (folder / 'DejaVuSans.ttf', folder / 'DejaVuSans-Bold.ttf')
    if normal.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont('Manual', str(normal)))
        pdfmetrics.registerFont(TTFont('ManualBold', str(bold)))
        pdfmetrics.registerFontFamily('Manual', normal='Manual', bold='ManualBold', italic='Manual', boldItalic='ManualBold')
        break
else:
    raise RuntimeError('Install Arial or DejaVu Sans before generating the manual.')

styles = getSampleStyleSheet()
for name in ['Normal', 'BodyText', 'Heading1', 'Heading2', 'Heading3', 'Title']:
    styles[name].fontName = 'ManualBold' if name.startswith('Heading') or name == 'Title' else 'Manual'
styles['BodyText'].fontSize = 10
styles['BodyText'].leading = 15
styles['BodyText'].spaceAfter = 9
styles['Heading1'].fontSize = 23
styles['Heading1'].leading = 29
styles['Heading1'].textColor = colors.HexColor('#123049')
styles['Heading2'].fontSize = 14
styles['Heading2'].leading = 19
styles.add(ParagraphStyle('Step', parent=styles['BodyText'], leftIndent=19, firstLineIndent=-19))
styles.add(ParagraphStyle('Note', parent=styles['BodyText'], backColor=colors.HexColor('#eff4f7'), borderPadding=10, spaceBefore=10, spaceAfter=14))
styles.add(ParagraphStyle('Small', parent=styles['BodyText'], fontSize=8, leading=12, textColor=colors.HexColor('#425566'), alignment=TA_LEFT))

class ManualDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        bookmark = getattr(flowable, '_bookmark', None)
        if bookmark:
            self.canv.bookmarkPage(bookmark)
            self.canv.addOutlineEntry(flowable.getPlainText(), bookmark, 0)

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#ccd7df'))
    canvas.line(45, 42, 567, 42)
    canvas.setFont('Manual', 8)
    canvas.setFillColor(colors.HexColor('#425566'))
    canvas.drawString(45, 27, 'MBFD Bid | Administrator Manual | September 2026')
    canvas.drawRightString(567, 27, str(doc.page))
    canvas.restoreState()

story = [Spacer(1, 1.0 * inch), Paragraph('MBFD BID', styles['Title']), Spacer(1, 20),
         Paragraph('Complete Administrator Manual', styles['Heading1']),
         Paragraph('People · Staffing · Annual Bid · History & Reports', styles['BodyText']),
         Spacer(1, 24), Paragraph('September 2026', styles['Heading2']),
         Paragraph('Use this manual alongside the searchable Docs page and the “How to use this page” explanation in each administrator workspace. The manual and live help use the same source content.', styles['BodyText']),
         Paragraph('Approved policy and amendments determine the rules. This manual explains software operation and does not adopt policy, authorize a selection, or establish that every qualification is current.', styles['Note']),
         Paragraph('Start at https://bid.mbfdhub.com/admin — administrator sign-in is required. Downloaded instructions remain readable offline; application links require a connection.', styles['BodyText']), PageBreak(),
         Paragraph('Contents', styles['Heading1'])]
for index, section in enumerate(sections, 1):
    story.append(Paragraph(f'{index}. <link href="#{section["id"]}" color="#164d78">{escape(section["title"])}</link>', styles['BodyText']))
for index, section in enumerate(sections, 1):
    story.append(PageBreak())
    heading = Paragraph(f'{index}. {escape(section["title"])}', styles['Heading1'])
    heading._bookmark = section['id']
    story.extend([heading, Paragraph(escape(section['category']), styles['Small']), Paragraph(escape(section['summary']), styles['BodyText']),
                  Paragraph(f'Open: <link href="https://bid.mbfdhub.com{section["route"]}" color="#164d78">{escape(section["routeLabel"])}</link>', styles['BodyText']), Paragraph('How to use it', styles['Heading2'])])
    for step, text in enumerate(section['steps'], 1):
        story.append(Paragraph(f'{step}. {escape(text)}', styles['Step']))
    story.append(Paragraph('Controls', styles['Heading2']))
    story.append(Paragraph(' · '.join(escape(text) for text in section['controls']), styles['BodyText']))
    if section.get('important'):
        story.append(Paragraph(escape(section['important']), styles['Note']))

doc = ManualDoc(str(OUTPUT), pagesize=(612, 792), leftMargin=45, rightMargin=45, topMargin=45, bottomMargin=58, title='MBFD Bid — Complete Administrator Manual', author='MBFD Bid')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
manifest = {'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'pdfSha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), 'sections': len(sections)}
(OUTPUT.parent / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'pdf': str(OUTPUT), 'sections': len(sections), 'bytes': OUTPUT.stat().st_size}))
