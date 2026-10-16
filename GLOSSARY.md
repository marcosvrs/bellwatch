# Bellwatch

Bellwatch discovers property listings from multiple sources, enriches their facts, and tracks changes for notification.

## Language

**Listing**:
A property offering identified within a listing source. Listings from different sources may refer to the same property, but retain their own source identity.

**Listing group**:
A set of Listings treated as observations of the same underlying property. Each Listing retains its source identity; a Listing may remain ungrouped when evidence is insufficient or conflicting.

**Listing source**:
A provider that publishes property offerings, such as Daft or MyHome.

**Listing facts**:
Source-neutral information about a Listing, distinct from evidence that is specific to one Listing source.

**Listing evidence**:
Source-specific information that supports or qualifies facts about a Listing. Evidence from one source is not interchangeable with another source's evidence.

**Finding**:
An observation assembled from a Listing source for a particular Listing. A Finding may include incomplete facts and source-specific evidence.
