import requests
from html.parser import HTMLParser


class _CellParser(HTMLParser):
    """Collects the text of every <td> table cell, in document order."""

    def __init__(self):
        super().__init__()
        self._in_td = False
        self._buf = ""
        self.cells = []

    def handle_starttag(self, tag, attrs):
        if tag == "td":
            self._in_td = True
            self._buf = ""

    def handle_endtag(self, tag):
        if tag == "td":
            self._in_td = False
            self.cells.append(self._buf.strip())

    def handle_data(self, data):
        if self._in_td:
            self._buf += data


def print_secret_message(url):
    # 1. Retrieve the published document.
    html = requests.get(url).text

    # 2. Parse the table. Columns are: x-coordinate, character, y-coordinate,
    #    preceded by a header row we skip by ignoring non-numeric coordinates.
    parser = _CellParser()
    parser.feed(html)
    cells = parser.cells

    points = []
    for i in range(0, len(cells) - 2, 3):
        x_raw, char, y_raw = cells[i], cells[i + 1], cells[i + 2]
        if x_raw.isdigit() and y_raw.isdigit():
            points.append((int(x_raw), int(y_raw), char))

    if not points:
        print("(no character data found)")
        return

    # 3. Build the grid sized to the largest coordinates. (0,0) is the
    #    top-left corner: x increases to the right, y increases downward.
    width = max(x for x, _, _ in points) + 1
    height = max(y for _, y, _ in points) + 1
    grid = [[" "] * width for _ in range(height)]

    # 4. Place each character; unspecified cells stay as spaces.
    for x, y, char in points:
        grid[y][x] = char

    # 5. Print row 0 first (top), forming the upright letters.
    for row in grid:
        print("".join(row))


if __name__ == "__main__":
    URL = ("https://docs.google.com/document/d/e/2PACX-1vSvM5gDINvt7npYHhp_"
           "XfsJvuntUhq184By5xO_pA4b_gCWeXb6dM6ZxwN8rE6S4ghUsCj2VKR21oEP/pub")
    print_secret_message(URL)
