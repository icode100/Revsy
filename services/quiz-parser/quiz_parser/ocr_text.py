"""Deterministic OCR table normalization with explicit row/cell relationships."""

from html.parser import HTMLParser
import re

from .domain import InvalidImport


class TableReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cell = [], None, None
        self.table_depth = 0

    def handle_starttag(self, tag, attributes):
        if tag == "table":
            self.table_depth += 1
            if self.table_depth > 1:
                raise InvalidImport("Nested OCR tables are ambiguous. Export a simpler PDF table.")
        elif tag == "tr":
            if self.row is not None:
                self.finish_row()
            self.row = []
        elif tag in {"td", "th"}:
            if self.row is None:
                self.row = []
            self.finish_cell()
            properties = dict(attributes)
            try:
                colspan = int(properties.get("colspan", "1"))
                rowspan = int(properties.get("rowspan", "1"))
            except ValueError as exc:
                raise InvalidImport("An OCR table has invalid cell spans.") from exc
            if not 1 <= colspan <= 20 or not 1 <= rowspan <= 200:
                raise InvalidImport("An OCR table is too large to import safely.")
            self.cell = {"text": [], "colspan": colspan, "rowspan": rowspan}
        elif self.cell is not None and tag == "br":
            self.cell["text"].append(" ")
        elif self.cell is not None and tag == "sup":
            self.cell["text"].append("^{")
        elif self.cell is not None and tag == "sub":
            self.cell["text"].append("_{")

    def handle_endtag(self, tag):
        if tag in {"td", "th"}:
            self.finish_cell()
        elif tag == "tr":
            self.finish_row()
        elif tag == "table":
            self.finish_row()
            self.table_depth -= 1
        elif self.cell is not None and tag in {"sup", "sub"}:
            self.cell["text"].append("}")

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"].append(data)

    def finish_cell(self):
        if self.cell is not None:
            self.cell["text"] = re.sub(r"\s+", " ", "".join(self.cell["text"])).strip()
            self.row.append(self.cell)
            self.cell = None

    def finish_row(self):
        self.finish_cell()
        if self.row:
            self.rows.append(self.row)
            if len(self.rows) > 500:
                raise InvalidImport("An OCR table has too many rows. Split the PDF.")
        self.row = None

    def markdown(self):
        self.finish_row()
        output, active_spans = [], {}
        for row in self.rows:
            cells = {column: text for column, (text, remaining) in active_spans.items()}
            new_spans, column = {}, 0
            for cell in row:
                while column in cells:
                    column += 1
                for offset in range(cell["colspan"]):
                    value = cell["text"] if offset == 0 else ""
                    cells[column + offset] = value
                    if cell["rowspan"] > 1:
                        new_spans[column + offset] = (value, cell["rowspan"] - 1)
                column += cell["colspan"]
                if column > 20:
                    raise InvalidImport("An OCR table has too many columns.")
            active_spans = {column: (text, remaining - 1) for column, (text, remaining) in active_spans.items() if remaining > 1}
            active_spans.update(new_spans)
            if cells:
                values = [cells.get(column, "") for column in range(max(cells) + 1)]
                output.append("| " + " | ".join(values) + " |")
        return "\n".join(output)


def normalize_html_tables(text: str) -> str:
    if not isinstance(text, str):
        raise InvalidImport("The OCR service returned invalid document text.")

    def replace_table(match):
        reader = TableReader()
        reader.feed(match.group(0))
        reader.close()
        return "\n" + reader.markdown() + "\n"

    return re.sub(r"<table\b[^>]*>.*?</table\s*>", replace_table, text, flags=re.I | re.S)
