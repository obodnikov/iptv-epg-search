# Claude Chat Export
**Generated: 2026-01-26 20:36:51**

---

👤 **USER:**
> On line "Search Result" - see screenshot - add checkbox like "Unique" (suggest better text) which filter all results with the same title/channel_name and show only result with the time closest to current time. The rest of filters should be still in place

---

👤 **USER:**
> [Image: original 2614x224, displayed at 2000x171. Multiply coordinates by 1.31 to map to original image.]

I'll help you add a checkbox to filter duplicate results. First, let me understand the current architecture and coding rules.

Based on my analysis of the codebase, I understand your request. You want to add a checkbox in the "Search Results" header that filters out duplicate programs (same title+channel_name), keeping only the one with the time closest to current time.

## Proposed Solution

### 1. **UI Placement**
Add a checkbox control after the channel filter button, before the results count:

```
[Grid] [List]  [Sort ▼]  [Channels (927/1185)]  ☐ Show Once  100 of 3,591 results
```

**Label suggestions:**
- "Show Once" (concise, clear)
- "Unique Only" (technical but clear)
- "Deduplicate" (single word)
- "One per Program" (descriptive)

I recommend **"Show Once"** - it's short, user-friendly, and clearly indicates the functionality.

### 2. **Filtering Logic**

When enabled, the filter will:
1. Group results by `title + channelName` combination
2. For each group, calculate time difference between program start time and current time
3. Keep only the program with smallest absolute time difference
4. Preserve all other active filters (search, time filter, channel filter, sort)

### 3. **Implementation Details**

**Files to modify:**
- [index.html](public/index.html:236-260) - Add checkbox control in results header
- [main.js](public/scripts/main.js:39-53) - Add `showUniqueOnly: false` to appState
- [search.js](public/scripts/utils/search.js) - Add `filterUniqueProgramsbyClosestTime()` function
- CSS files - Style the checkbox to match sqowe brand

**Technical approach:**
```javascript
function filterUniqueByClosestTime(programs) {
  const now = new Date();
  const grouped = new Map();
  
  programs.forEach(program => {
    const key = `${program.title}|${program.channelName}`;
    const timeDiff = Math.abs(program.start - now);
    
    if (!grouped.has(key) || timeDiff < grouped.get(key).timeDiff) {
      grouped.set(key, { program, timeDiff });
    }
  });
  
  return Array.from(grouped.values()).map(item => item.program);
}
```

### 4. **Behavior Details**

- **Default state:** Unchecked (show all results)
- **Persistence:** Save preference to localStorage
- **Integration:** Applied AFTER all other filters but BEFORE sorting
- **Results count:** Update to show filtered count

### 5. **Questions for You**

1. **Label preference:** Do you like "Show Once" or prefer another label?
2. **Persistence:** Should the checkbox state persist across sessions (localStorage)?
3. **Visual style:** Checkbox or toggle switch?
4. **Scope:** Should this consider only `title + channelName`, or also include other fields like episode number?

**Would you like me to proceed with this implementation?**

---

👤 **USER:**
> Label preference:  "Show Once"  is fine
Persistence: Should the checkbox state persist across sessions - yes
Visual style: Checkbox
Scope:  Let start with only title + channelName
Yes you can start implementation

I'll implement the "Show Once" checkbox feature. Let me start by reading the storage utility to understand the localStorage pattern.

Now I'll implement the "Show Once" feature. Let me start by adding the storage functions.

Perfect! The implementation is complete. The CSS already has checkbox styles that follow the sqowe brand guidelines.

## Summary of Changes

I've successfully implemented the "Show Once" checkbox feature. Here's what was added:

### Files Modified

| File | Changes |
|------|---------|
| [storage.js](public/scripts/utils/storage.js:6-11) | Added `SHOW_UNIQUE_ONLY` storage key |
| [storage.js](public/scripts/utils/storage.js:190-219) | Added `saveShowUniqueOnly()` and `getShowUniqueOnly()` functions |
| [search.js](public/scripts/utils/search.js:75-94) | Added `filterUniqueByClosestTime()` function that groups by title+channel and keeps closest to current time |
| [index.html](public/index.html:257-260) | Added "Show Once" checkbox with label after channel filter button |
| [main.js](public/scripts/main.js:21) | Imported new storage and search functions |
| [main.js](public/scripts/main.js:52) | Added `showUniqueOnly` to appState, loaded from localStorage |
| [main.js](public/scripts/main.js:180-196) | Added checkbox initialization and event handler |
| [main.js](public/scripts/main.js:610-614) | Applied unique filter in `performSearch()` after all other filters but before sorting |

### Features Implemented

✅ **Checkbox control** - Positioned after "Channels" button, before results count  
✅ **Filtering logic** - Groups by `title + channelName`, keeps program with time closest to current time  
✅ **localStorage persistence** - Checkbox state saved and restored across sessions  
✅ **Default state** - Unchecked (shows all results) by default  
✅ **Filter integration** - Applied after search/time/channel filters, before sorting  
✅ **Logging** - Console log shows unique program count when filter is active  
✅ **Styling** - Uses existing checkbox CSS following sqowe brand guidelines

The feature is ready to use. When checked, it will filter duplicate programs (same title and channel) and show only the one with the broadcast time closest to the current time, while preserving all other active filters.

---

👤 **USER:**
> reflect on code review comments in /tmp/last-review-20260126-195951.md

I've reviewed the code review comments. Here's my assessment:

## Review Analysis

| Issue | Severity | Valid? | Assessment |
|-------|----------|--------|------------|
| Date validation bug | HIGH | ✅ Yes | Real bug - NaN comparison leads to incorrect filtering |
| Missing tests | MEDIUM | ✅ Yes | Valid but no test infrastructure exists yet |

## Issue #1 - The Bug (HIGH - BLOCKING)

The review is correct. The `filterUniqueByClosestTime` function has a critical bug:

**Problem:**
```javascript
const timeDiff = Math.abs(program.start - now);
```

If `program.start` is null, undefined, or an invalid Date:
- `Math.abs(null - now)` → NaN
- `NaN < someNumber` → always false
- Invalid programs may be kept instead of valid ones

**Impact:**
- Invalid/broken programs could appear in results
- Valid programs might be filtered out
- Behavior depends on program order (unpredictable)

## Proposed Fix

Add validation to skip invalid programs and log warnings:

```javascript
export function filterUniqueByClosestTime(programs) {
  const now = new Date();
  const grouped = new Map();

  programs.forEach(program => {
    // Validate program.start is a valid Date
    if (!program.start || !(program.start instanceof Date) || isNaN(program.start.getTime())) {
      console.warn('Skipping program with invalid start time:', program.title, program.channelName);
      return; // Skip invalid programs
    }

    const key = `${program.title}|${program.channelName}`;
    const timeDiff = Math.abs(program.start - now);

    if (!grouped.has(key) || timeDiff < grouped.get(key).timeDiff) {
      grouped.set(key, { program, timeDiff });
    }
  });

  return Array.from(grouped.values()).map(item => item.program);
}
```

## Issue #2 - Missing Tests (MEDIUM)

Valid concern, but the codebase currently has:
- ❌ No test framework (Jest, Vitest, etc.)
- ❌ No test files
- ❌ No test scripts in package.json

**Recommendation:** Defer to future test infrastructure setup phase.

---

**Would you like me to:**
1. ✅ Fix only the HIGH severity bug (date validation)?
2. Fix bug + setup test infrastructure + write tests?
3. Something else?

---

👤 **USER:**
> fix only the HIGH severity bug

I'll fix the HIGH severity bug by adding Date validation to the `filterUniqueByClosestTime` function.

Fixed. The HIGH severity bug has been resolved.

## Changes Made

Updated [search.js:79-92](public/scripts/utils/search.js#L79-L92) to add Date validation before calculating time differences.

### What was fixed:

**Before (buggy):**
```javascript
programs.forEach(program => {
  const key = `${program.title}|${program.channelName}`;
  const timeDiff = Math.abs(program.start - now);  // ❌ NaN if start is invalid
  ...
});
```

**After (fixed):**
```javascript
programs.forEach(program => {
  // Validate program.start is a valid Date
  if (!program.start || !(program.start instanceof Date) || isNaN(program.start.getTime())) {
    console.warn('Skipping program with invalid start time:', program.title, program.channelName);
    return; // Skip invalid programs
  }

  const key = `${program.title}|${program.channelName}`;
  const timeDiff = Math.abs(program.start - now);  // ✅ Safe: only valid Dates reach here
  ...
});
```

### Protection added:

1. ✅ Checks if `program.start` exists (not null/undefined)
2. ✅ Validates it's a Date instance
3. ✅ Ensures it's not an invalid Date (NaN)
4. ✅ Logs warning and skips invalid programs
5. ✅ Prevents NaN comparisons that cause incorrect filtering

The bug is now fixed and the function will handle invalid date entries gracefully.

---

👤 **USER:**
> reflect on next code review comments (skip tests part) in /tmp/last-review-20260126-200204.md

I've reviewed the code review comments (skipping tests). Here's my analysis:

## Review Analysis (Non-Test Issues)

| Issue | Severity | Valid? | Assessment |
|-------|----------|--------|------------|
| Checkbox handler condition | HIGH | ⚠️ Partially | Current behavior is intentional but could be clearer |
| Key generation & ties handling | MEDIUM | ✅ Yes | Real issue - undefined fields and non-deterministic ties |

## Issue #1 - Checkbox Handler (HIGH - BLOCKING)

**Reviewer's claim:** "toggling checkbox without active search won't apply the unique filter"

**Current behavior:**
```javascript
if (appState.currentResults.length > 0 || appState.searchQuery.length >= 2 || appState.timeFilter !== 'all') {
  performSearch();
}
```

**My analysis:**
The current implementation is actually **correct by design**. Here's why:

1. The app **intentionally** doesn't show all programs without filters (due to performance - 100+ result limit)
2. `performSearch()` itself validates and requires: `query.length >= 2` OR `timeFilter !== 'all'`
3. The checkbox handler respects this by only triggering search when there's something to search

**However,** the reviewer has a point about user experience:
- If user toggles checkbox with **existing results displayed**, it should update immediately ✅ (works - `currentResults.length > 0`)
- If user toggles checkbox with **no results shown**, saving the preference silently is correct ✅ (will apply to next search)

**I think the current code is correct**, but I want to confirm with you: Should the checkbox work without any search/filter active?

## Issue #4 - Key Generation & Ties (MEDIUM - QUALITY)

This is a **real issue** that should be fixed:

### Problem 1: Undefined fields
```javascript
const key = `${program.title}|${program.channelName}`;
// If title is undefined: "undefined|Channel1"
// Multiple programs with undefined title would be grouped together incorrectly
```

### Problem 2: Non-deterministic tie handling
```javascript
if (!grouped.has(key) || timeDiff < grouped.get(key).timeDiff) {
  // If two programs have identical timeDiff, keeps first one encountered
  // This is non-deterministic if array order changes
}
```

**Proposed fix:**
```javascript
export function filterUniqueByClosestTime(programs) {
  const now = new Date();
  const grouped = new Map();

  programs.forEach(program => {
    // Validate program.start is a valid Date
    if (!program.start || !(program.start instanceof Date) || isNaN(program.start.getTime())) {
      console.warn('Skipping program with invalid start time:', program.title, program.channelName);
      return;
    }

    // Validate required fields for key generation
    if (!program.title || !program.channelName) {
      console.warn('Skipping program with missing title or channelName:', program);
      return;
    }

    const key = `${program.title}|${program.channelName}`;
    const timeDiff = Math.abs(program.start - now);

    // For ties, prefer earlier start time (deterministic)
    const existing = grouped.get(key);
    if (!existing || 
        timeDiff < existing.timeDiff || 
        (timeDiff === existing.timeDiff && program.start < existing.program.start)) {
      grouped.set(key, { program, timeDiff });
    }
  });

  return Array.from(grouped.values()).map(item => item.program);
}
```

---

**My recommendation:**
1. **Issue #1 (HIGH):** I believe current behavior is correct, but want your confirmation
2. **Issue #4 (MEDIUM):** Should definitely be fixed - adds validation and deterministic tie-breaking

Would you like me to:
- **A)** Fix only Issue #4 (quality improvements)
- **B)** Fix both issues
- **C)** Explain Issue #1 more before deciding

---

👤 **USER:**
> Option A

I'll fix Issue #4 by adding validation for required fields and deterministic tie-breaking.

Fixed. Issue #4 has been resolved with quality improvements.

## Changes Made

Updated [search.js:79-106](public/scripts/utils/search.js#L79-L106) to add field validation and deterministic tie-breaking.

### What was fixed:

**Problem 1 - Undefined field validation:**
```javascript
// Added validation before key generation
if (!program.title || !program.channelName) {
  console.warn('Skipping program with missing title or channelName:', program);
  return;
}
```

**Problem 2 - Deterministic tie-breaking:**
```javascript
// Before: non-deterministic when timeDiff is equal
if (!grouped.has(key) || timeDiff < grouped.get(key).timeDiff) {
  grouped.set(key, { program, timeDiff });
}

// After: deterministic - prefers earlier start time on ties
const existing = grouped.get(key);
if (!existing ||
    timeDiff < existing.timeDiff ||
    (timeDiff === existing.timeDiff && program.start < existing.program.start)) {
  grouped.set(key, { program, timeDiff });
}
```

### Improvements:

✅ **Prevents undefined key collisions** - Programs with missing title/channelName are skipped with warning  
✅ **Deterministic tie handling** - When two programs have identical distance from current time, the earlier one is consistently selected  
✅ **Better error messages** - Logs the full program object when title/channelName is missing  
✅ **Robust grouping** - Keys are only generated from validated string values

The function now handles edge cases gracefully and produces consistent, predictable results.

---

👤 **USER:**
> suggest commit message

```
Add "Show Once" filter to display unique programs by closest time

- New checkbox in search results header to filter duplicate programs
- Groups by title+channel combination, keeps program closest to current time
- Persists checkbox state to localStorage across sessions
- Validates program.start as valid Date to prevent NaN comparisons
- Validates title and channelName fields to prevent undefined key collisions
- Implements deterministic tie-breaking (prefers earlier start time)
- Skips invalid programs with console warnings for debugging
- Applied after all other filters but before sorting

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

---

👤 **USER:**
> Check attached screenshot. Suggest more beautiful view of Search Result lane

---

👤 **USER:**
> [Image: original 2508x302, displayed at 2000x241. Multiply coordinates by 1.25 to map to original image.]

Looking at the screenshot, I can see several areas for improvement in the Search Results header. Let me suggest a more polished layout.

## Current Issues

1. **Poor visual hierarchy** - All controls appear at the same level
2. **Cramped spacing** - Elements are too close together
3. **Weak visual grouping** - Related controls aren't clearly grouped
4. **Long results text** - "Showing 100 of 6 659 results (limited for performance)" is verbose

## Proposed Improvements

### 1. **Better Visual Grouping**

Group controls by function:
- **View controls** (Grid/List) - Left side
- **Filter controls** (Sort, Channels, Show Once) - Right side
- **Results count** - Far right or below

### 2. **Improved Layout**

```
┌─────────────────────────────────────────────────────────────────┐
│ Search Results                                    100 of 6,659  │
├─────────────────────────────────────────────────────────────────┤
│ [Grid][List]     [Best Match ▼] [Channels All] ☐ Show Once    │
└─────────────────────────────────────────────────────────────────┘
```

### 3. **Specific Changes**

**HTML structure:**
- Move results count next to "Search Results" heading
- Add visual separators between control groups
- Improve checkbox styling with better label association

**Styling:**
- Add `gap` between control groups (12-16px)
- Use subtle background for control bar
- Better padding and spacing
- Align items consistently

Would you like me to implement these improvements? I can:

**Option A:** Redesign the entire Search Results header with better spacing, grouping, and visual hierarchy

**Option B:** Make targeted improvements (spacing, results count, checkbox styling) while keeping the current structure

**Option C:** Show you mockup/wireframe first before implementing

Which approach would you prefer?

---

👤 **USER:**
> Yes redesign with Proposed Improvements

I'll redesign the Search Results header with better visual hierarchy, grouping, and spacing following the sqowe brand guidelines.

Now let me create the CSS for the redesigned results header:

Perfect! The redesign is complete. Here's what I've implemented:

## Summary of Changes

### 1. **New HTML Structure** ([index.html](public/index.html:233-278))

**Before:**
- Single row with everything crammed together
- Poor visual hierarchy

**After:**
```html
<div class="results-header">
  <!-- Top row: Title + Results count -->
  <div class="results-header-top">
    <h2 class="results-title">Search Results</h2>
    <p id="resultsCount" class="results-count"></p>
  </div>

  <!-- Bottom row: Controls in logical groups -->
  <div class="results-controls">
    <!-- View Toggle Group (Left) -->
    <div class="results-control-group">
      [Grid] [List]
    </div>

    <!-- Filter Controls Group (Right) -->
    <div class="results-control-group results-filters">
      [Sort ▼] [Channels] [☐ Show Once]
    </div>
  </div>
</div>
```

### 2. **New CSS File** ([results.css](public/styles/components/results.css))

**Key improvements:**
- ✅ **Card-style header** - White background with subtle shadow
- ✅ **Clear visual hierarchy** - Title and count on top, controls below
- ✅ **Separator line** - Between title row and controls
- ✅ **Logical grouping** - View controls left, filters right
- ✅ **Better spacing** - 16px gaps between groups, 12px between items
- ✅ **Hover states** - Checkbox label has subtle hover effect
- ✅ **Compact controls** - Smaller font sizes for controls
- ✅ **Fully responsive** - Stacks on mobile, full width controls

### 3. **Visual Improvements**

**Typography:**
- Results title: Bold, dark purple (sqowe brand)
- Results count: Medium weight, light grey
- Controls: Small, clean text

**Spacing:**
- Header padding: 24px (desktop), 16px (mobile)
- Control groups: 24px gap
- Control items: 12px gap
- Bottom border under title: 1px subtle divider

**Responsive:**
- **Desktop:** Side-by-side layout
- **Tablet:** Wraps to 2 rows if needed
- **Mobile:** Full vertical stack, full-width controls

The redesigned header now has:
- 🎯 Clear visual hierarchy
- 📱 Better mobile experience
- 🎨 Cleaner, more polished appearance
- 🧩 Logical control grouping
- ✨ Following sqowe brand guidelines

---

👤 **USER:**
> suggest commit message

```
Redesign Search Results header with improved layout and visual hierarchy

- Move results count next to title in top row with separator line
- Group controls logically: view toggle (left), filters (right)
- Add card-style header with white background and subtle shadow
- Improve spacing: 24px between groups, 12px between items
- Add hover effect to "Show Once" checkbox label
- Create dedicated results.css for results section styles
- Implement responsive design: stacks vertically on mobile
- Use compact form controls with smaller font sizes
- Follow sqowe brand guidelines for colors and typography
- Better visual separation between title area and controls

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

---

👤 **USER:**
> check attached screenshot. Thisnk about how we can prevent dublication between HD and non HD same channels and leave only HD

---

👤 **USER:**
> [Image: original 2528x772, displayed at 2000x611. Multiply coordinates by 1.26 to map to original image.]

Looking at the screenshot, I can see the issue: the same program "Убийства в цифрах" appears on both "INVESTIGATION DISCOVERY" and "INVESTIGATION DISCOVERY HD" channels at the same time.

The current "Show Once" filter groups by `title + channelName`, so these are considered different. We need to enhance the logic to:

## Proposed Solution

**Enhance "Show Once" to prefer HD channels automatically**

### New Grouping Logic:

Instead of grouping by `title + channelName`, group by `title + startTime`, then prefer HD channels when duplicates exist.

### Algorithm:

```javascript
1. Group programs by: title + start time (ignore channel)
2. For each group with multiple channels:
   - Prefer channels with "HD", "UHD", "4K" in name
   - If multiple HD channels exist, pick first one
   - If no HD channels, pick any channel
3. Return one program per group
```

### Example Result:

**Before (current "Show Once"):**
- ✅ "Убийства в цифрах" on INVESTIGATION DISCOVERY (kept - closest time)
- ✅ "Убийства в цифрах" on INVESTIGATION DISCOVERY HD (kept - different channel)

**After (enhanced "Show Once"):**
- ❌ "Убийства в цифрах" on INVESTIGATION DISCOVERY (removed - HD version exists)
- ✅ "Убийства в цифрах" on INVESTIGATION DISCOVERY HD (kept - HD preferred)

### Implementation Changes:

```javascript
// Change from:
const key = `${program.title}|${program.channelName}`;

// To:
const key = `${program.title}|${program.start.getTime()}`;

// And add HD preference logic:
if (!existing || isHDChannel(program.channelName) > isHDChannel(existing.program.channelName)) {
  grouped.set(key, { program, timeDiff });
}
```

---

**Questions for you:**

1. **Should this be the default behavior** of "Show Once", or add as a separate option like "☐ Prefer HD channels"?

2. **What if there are multiple HD channels** with the same program (e.g., "Discovery HD" and "Discovery HD+")?  Should we:
   - Keep first HD found?
   - Keep the one with highest quality indicator (4K > UHD > HD)?

3. **Should we also handle SD variants** (remove "CHANNEL SD" if "CHANNEL" or "CHANNEL HD" exists)?

Would you like me to implement this enhancement?

---

👤 **USER:**
> 1. add "☐ Prefer HD channels"
2. Keep the one with highest quality indicator (4K > UHD > HD)
3. Should we also handle SD variants - yes if program the same
Confirm that all open questions have been answered

Perfect! All questions answered. Let me confirm the implementation plan:

## Implementation Plan

### 1. **New "Prefer HD channels" checkbox**
- Add checkbox next to "Show Once" in results header
- Independent toggle (can use together with "Show Once" or separately)
- Persists to localStorage

### 2. **Quality Ranking**
```
4K > UHD > HD > Regular > SD
```

### 3. **Behavior Examples**

**Prefer HD disabled (current behavior):**
- "Program A" on "Discovery" at 10:00 ✅
- "Program A" on "Discovery HD" at 10:00 ✅
- "Program A" on "Discovery 4K" at 10:00 ✅
(All shown - different channels)

**Prefer HD enabled:**
- "Program A" on "Discovery" at 10:00 ❌ (removed - 4K exists)
- "Program A" on "Discovery HD" at 10:00 ❌ (removed - 4K exists)
- "Program A" on "Discovery 4K" at 10:00 ✅ (kept - highest quality)

**With SD variant:**
- "Program B" on "Discovery SD" at 11:00 ❌ (removed - HD exists)
- "Program B" on "Discovery" at 11:00 ❌ (removed - HD exists)
- "Program B" on "Discovery HD" at 11:00 ✅ (kept - highest available)

### 4. **Combined with "Show Once"**

Both checkboxes checked:
- First apply "Show Once" (keep program closest to current time per title+channel)
- Then apply "Prefer HD" (deduplicate across channels, keep highest quality)

### 5. **Quality Detection Logic**
```javascript
function getChannelQuality(channelName) {
  if (/4K/i.test(channelName)) return 4;
  if (/UHD/i.test(channelName)) return 3;
  if (/HD/i.test(channelName)) return 2;
  if (/SD/i.test(channelName)) return 0;
  return 1; // Regular
}
```

---

**Ready to implement?**

---

👤 **USER:**
> yes implement

I'll implement the "Prefer HD channels" feature. Let me start by adding the storage functions, then the filter logic, and finally the UI.

Perfect! The "Prefer HD" feature is now fully implemented. Here's what was added:

## Implementation Summary

### 1. **Storage Functions** ([storage.js](public/scripts/utils/storage.js))
- Added `PREFER_HD` storage key
- Added `savePreferHD()` and `getPreferHD()` functions
- Persists preference to localStorage (default: false)

### 2. **Filter Logic** ([search.js](public/scripts/utils/search.js))

**New helper function:**
```javascript
getChannelQuality(channelName)
- Returns: 4 (4K) > 3 (UHD) > 2 (HD) > 1 (Regular) > 0 (SD)
```

**New filter function:**
```javascript
filterPreferHD(programs)
- Groups by: title + start time (ignores channel)
- Keeps: highest quality channel
- Fallback: alphabetically first if same quality (deterministic)
```

### 3. **UI - New Checkbox** ([index.html](public/index.html:282-287))
```html
<label class="checkbox-label">
  <input type="checkbox" id="preferHDCheckbox">
  <span class="checkbox-text">Prefer HD</span>
</label>
```

### 4. **Integration** ([main.js](public/scripts/main.js))
- Added `preferHD` to `appState` (loaded from localStorage)
- Added checkbox event handler
- Applied filter in `performSearch()` after "Show Once" filter

### 5. **Filter Application Order**
```
1. Channel filter (selected channels)
2. Time filter (past/current/future)
3. Search filter (text search)
4. Show Once filter (closest to current time per title+channel)
5. Prefer HD filter (highest quality per title+time) ← NEW
6. Rating boost
7. Sort
```

## Usage Examples

**Prefer HD disabled (default):**
- Shows all quality variants of the same program

**Prefer HD enabled:**
- "Program" on "Discovery SD" ❌ (removed)
- "Program" on "Discovery" ❌ (removed)
- "Program" on "Discovery HD" ❌ (removed)
- "Program" on "Discovery 4K" ✅ (kept - highest quality)

**Combined with "Show Once":**
- First: Keep programs closest to current time per title+channel
- Then: Deduplicate across channels, keeping highest quality

The feature is ready to use!

---

👤 **USER:**
> suggest commit message

```
Add "Prefer HD" filter to deduplicate programs across channel quality variants

- New checkbox in results header to prefer HD channels over SD/regular
- Groups programs by title + start time (ignoring channel name)
- Keeps highest quality variant: 4K > UHD > HD > Regular > SD
- Add getChannelQuality() helper function to rank channel quality
- Add filterPreferHD() function to deduplicate by quality
- Add savePreferHD/getPreferHD storage functions with localStorage persistence
- Applied after "Show Once" filter, before rating boost and sorting
- Handles SD variants: removes "Channel SD" if "Channel HD" exists
- Deterministic tie-breaking: alphabetically first when same quality
- Independent toggle: works alone or combined with "Show Once"

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

