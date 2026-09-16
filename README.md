# Daft house search

Small consumer project that uses the published
[`daftlistings`](https://pypi.org/project/daftlistings/) package to search
Daft.ie listings.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Search

```bash
python search_houses.py
```

The script uses the package's documented `Daft` API and searches for:

- new homes;
- houses;
- at least three bedrooms;
- a maximum price of €499,999;
- Dublin City Centre within 20 km;
- results sorted by ascending price.

It prints each listing's title, price, and Daft URL. Search results are
candidates only; any Help to Buy or other scheme eligibility must be checked
separately.