FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_spreadsheet_cell(value):
    """Prevent CSV/XLSX clients from interpreting untrusted text as a formula."""
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def sanitize_spreadsheet_row(values):
    return [sanitize_spreadsheet_cell(value) for value in values]


def append_sanitized_row(worksheet, values):
    """Append a row to an openpyxl worksheet without creating formula cells."""
    worksheet.append(sanitize_spreadsheet_row(values))
