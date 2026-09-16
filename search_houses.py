from daftlistings import Daft, Distance, PropertyType, SearchType, SortType


def search_houses(max_pages=1):
    daft = Daft()
    daft.set_location("Dublin City Centre", Distance.KM20)
    daft.set_search_type(SearchType.NEW_HOMES)
    daft.set_property_type(PropertyType.HOUSE)
    daft.set_min_beds(3)
    daft.set_max_price(499_999)
    daft.set_sort_type(SortType.PRICE_ASC)
    return daft.search(max_pages=max_pages)


def main():
    for listing in search_houses():
        print(listing.title)
        print(listing.price)
        print(listing.daft_link)
        print()


if __name__ == "__main__":
    main()
