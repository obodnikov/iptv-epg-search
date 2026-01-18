# Fuzzy Search Feature Guide

## Overview

The fuzzy search feature enhances the IPTV EPG Search application with:
- **Morphology-aware search** - Handles Russian and English word variations (e.g., "Убийство" matches "Убийства")
- **Fuzzy matching** - Finds results even with typos and spelling variations
- **Program ratings** - Rate programs with 5-star system, with ratings boosting search results
- **Ratings management** - Export, import, and clear ratings

## Features

### 1. Fuzzy Search

**What it does:**
- Uses Snowball stemmer to normalize Russian and English words to their root forms
- Uses Fuse.js for fuzzy matching with configurable sensitivity
- Automatically detects language (Russian vs English)
- Falls back to exact match if libraries fail to load

**How to use:**
1. Load EPG data as usual
2. Toggle "Enable Fuzzy Search" in Settings (enabled by default)
3. Adjust sensitivity slider if needed (Medium is recommended)
4. Search normally - fuzzy matching happens automatically

**Examples:**
- Search "Убийство" finds "Убийства в Восточном экспрессе"
- Search "detectiv" finds "detective", "detectives", "detection"
- Search with typos like "progam" finds "program"

### 2. Program Ratings

**What it does:**
- Rate any program with 1-5 stars
- Ratings persist in browser localStorage
- Higher-rated programs appear first in search results (among equal matches)
- Ratings sync between card view and modal view

**How to use:**
1. Click stars on any program card to rate (1-5 stars)
2. Click the same rating again to remove it
3. Ratings automatically boost that program in future searches
4. View ratings in program detail modal

### 3. Ratings Management

**Export Ratings:**
- Click "Export Ratings" in Settings
- Downloads JSON file with all your ratings
- Filename includes date: `epg-ratings-2026-01-14.json`

**Import Ratings:**
- Click "Import Ratings" in Settings
- Select previously exported JSON file
- Validates format before importing
- Preserves existing ratings if import fails

**Clear All Ratings:**
- Click "Clear All" in Settings
- Confirms before deleting
- Cannot be undone (export first if needed)

## Technical Details

### Libraries Used

**Snowball Stemmer** (v0.6.0)
- Russian and English stemming
- Loaded from: `cdn.jsdelivr.net/npm/snowball-stemmers`
- Size: ~20KB

**Fuse.js** (v7.0.0)
- Fuzzy string matching
- Loaded from: `cdn.jsdelivr.net/npm/fuse.js`
- Size: ~25KB

### Configuration

**Fuzzy Threshold:**
- Range: 0.1 (very strict) to 0.9 (very loose)
- Default: 0.4 (medium)
- Lower = fewer but more accurate results
- Higher = more results but less accurate

**Search Index:**
- Built automatically when EPG data loads
- Pre-stems all program titles and descriptions
- Cached in memory for fast searches
- Rebuilds when new EPG data is loaded

### Performance

**Search Speed:**
- Target: <500ms for 50,000 programs
- Actual: ~50-100ms for typical datasets
- Index build: ~200-500ms (one-time per load)
- Debounced input: 300ms delay after typing stops

**Storage:**
- Ratings stored in localStorage
- Typical size: <10KB for 100 ratings
- No impact on EPG data loading

## Fallback Behavior

If Snowball or Fuse.js fail to load:
1. Fuzzy search toggle is disabled
2. Status message shows what's missing
3. Application falls back to exact match search
4. All other features continue to work normally

## Browser Compatibility

**Required:**
- ES6 modules support
- localStorage API
- Modern CSS (Grid, Flexbox, CSS Variables)

**Tested on:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Troubleshooting

**Fuzzy search not working:**
- Check browser console for CDN loading errors
- Verify internet connection (CDN required)
- Check Settings for fuzzy search status message
- Try disabling browser extensions that block CDNs

**Ratings not saving:**
- Check localStorage quota (usually 5-10MB)
- Export ratings and clear old data if quota exceeded
- Check browser privacy settings (localStorage must be enabled)

**Search too slow:**
- Reduce fuzzy threshold for stricter matching
- Use time filters to narrow results
- Limit search to title only (not description)

**Too many/few results:**
- Adjust fuzzy threshold slider in Settings
- Lower threshold = fewer, more accurate results
- Higher threshold = more results, less accurate

## Development Notes

**File Structure:**
```
public/scripts/utils/
  ├── fuzzySearch.js    # Stemming and fuzzy search logic
  ├── ratings.js        # Rating CRUD operations
  └── search.js         # Updated with rating boost

public/scripts/components/
  ├── ratingControl.js  # Star rating UI component
  ├── results.js        # Updated with rating controls
  └── settings.js       # Updated with ratings management

public/styles/components/
  └── rating.css        # Rating component styles
```

**Key Functions:**
- `initSearchIndex()` - Build Fuse.js index with stemmed data
- `fuzzySearch()` - Perform fuzzy search with stemming
- `applyRatingBoost()` - Sort results with rating tiebreaker
- `createRatingControl()` - Create interactive star rating UI

## Future Enhancements

Potential improvements (not yet implemented):
- Pagination for >100 results
- Search history
- Favorite programs (separate from ratings)
- Rating statistics dashboard
- Collaborative filtering (if backend added)
- Custom stemming dictionaries
- Search result highlighting

## Credits

- **Snowball Stemmer**: Martin Porter's stemming algorithm
- **Fuse.js**: Fuzzy search library by Kirollos Risk
- **Design**: sqowe brand guidelines
