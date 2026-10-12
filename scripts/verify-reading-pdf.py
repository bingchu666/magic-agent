"""Create an original three-page fixture for PDF upload and page citation QA."""
import sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

output = sys.argv[1]
document = canvas.Canvas(output, pagesize=A4)
pages = [
    ("Page 1 - Effect and preparation", [
        "The Three Card Locator - an original synthetic test lesson.",
        "Author: Mira Sol, a fictional author for this test only.",
        "Props: three ordinary cards and a table.",
        "Preparation: secretly remember the bottom card as the key card.",
        "No duplicate cards, wallets, coins, glue or flames are required.",
    ]),
    ("Page 2 - Method", [
        "Let the spectator remember the top card without changing order.",
        "Have the spectator place that card on the table.",
        "Put the remaining two-card packet on top of the selection.",
        "The remembered key card is directly above the selected card.",
        "Find the key card and reveal the card directly beneath it.",
    ]),
    ("Page 3 - Practice", [
        "Repeat the entire sequence exactly five times.",
        "Check that the key card stays directly above the selection.",
        "The verification code for this practice plan is ORCHID-73.",
        "This document gives no publication date or wallet method.",
        "State when a requested topic is not covered by this document.",
    ]),
]
for title, lines in pages:
    document.setFont("Helvetica-Bold", 18)
    document.drawString(50, 780, title)
    document.setFont("Helvetica", 12)
    for index, line in enumerate(lines):
        document.drawString(50, 725 - index * 27, line)
    document.showPage()
document.save()
print(output)
