# IPTV EPG Search

A simple web application for searching and browsing IPTV Electronic Program Guide (EPG) data.

## Features

- **EPG URL Management**: Store EPG URL locally in your browser
- **Search Programs**: Search by program title or description
- **Time Filters**: Filter programs by past, current, or future
- **Clean UI**: Material-inspired design following sqowe brand guidelines
- **Responsive**: Works on mobile, tablet, and desktop devices
- **Client-side**: All processing happens in your browser

## Getting Started

### 1. Open the Application

Simply open `public/index.html` in your web browser. You can:

- Double-click the file in your file manager, or
- Use a local web server (recommended)

### Using a Local Web Server (Recommended)

Using a local web server prevents CORS issues and provides better performance.

**Option A: Python**
```bash
# Python 3
cd /Users/mike/src/iptv-web/public
python3 -m http.server 8000
```

**Option B: Node.js (http-server)**
```bash
# Install http-server globally
npm install -g http-server

# Run from project root
cd /Users/mike/src/iptv-web
http-server public -p 8000
```

**Option C: PHP**
```bash
cd /Users/mike/src/iptv-web/public
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

### 2. Configure EPG URL

1. Click the "Settings" button in the header
2. Enter your EPG URL (default is pre-filled: `http://s03.wsbof.com:8080/xml/4a27b28d.gz`)
3. Click "Save Settings"

The URL will be stored in your browser's localStorage.

### 3. Load EPG Data

1. Click the "Load EPG Data" button
2. Wait for the data to be fetched, decompressed, and parsed
3. Once loaded, you can start searching

### 4. Search and Filter

- **Search**: Type in the search box to find programs by title or description
- **Time Filter**: Select a filter to show:
  - All Programs
  - Past programs
  - Current programs (airing now)
  - Future programs
- Click "Search" to see results

## Project Structure

```
iptv-web/
├── public/
│   └── index.html           # Main HTML file
├── styles/
│   ├── base.css            # CSS variables, resets, typography
│   ├── layout.css          # Grid, containers, layout utilities
│   └── components/
│       ├── button.css      # Button styles
│       ├── card.css        # Card component styles
│       └── form.css        # Form and input styles
├── scripts/
│   ├── main.js             # Application bootstrap
│   ├── utils/
│   │   ├── storage.js      # localStorage management
│   │   ├── epgParser.js    # XML parsing and decompression
│   │   └── search.js       # Search and filter logic
│   └── components/
│       ├── settings.js     # Settings UI component
│       └── results.js      # Results display component
└── README.md               # This file
```

## Technical Details

### Dependencies

- **Pako**: For gzip decompression (loaded via CDN)
- **Google Fonts**: Montserrat font family

No build tools or package managers required!

### Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6 modules support required
- localStorage API required

### EPG XML Format

The application expects EPG data in XMLTV format:

```xml
<tv>
  <channel id="channel1">
    <display-name>Channel Name</display-name>
  </channel>
  <programme start="20240115103000 +0000" stop="20240115113000 +0000" channel="channel1">
    <title>Program Title</title>
    <desc>Program description</desc>
  </programme>
</tv>
```

The file should be gzip-compressed (.gz extension).

## CORS Considerations

If you encounter CORS errors:

1. **Use a local web server** (recommended - see "Getting Started" above)
2. **Check EPG server configuration**: The EPG server must allow cross-origin requests
3. **Use a CORS proxy**: Services like cors-anywhere can proxy requests
4. **Browser extension**: Install a CORS-unblocking extension (development only)

## Design System

This application follows the **sqowe brand design system**:

- **Colors**:
  - Dark Ground: #222222
  - Light Purple: #8E88A3
  - Dark Purple: #5B5377
  - Light Grey: #B2B3B2

- **Typography**: Montserrat font family (Light 300, Regular 400, Medium 500, Bold 700)

- **Layout**: 8px spacing grid, Material-inspired elevation and shadows

## Development

### Code Guidelines

All code follows the guidelines specified in:
- [AI.md](AI.md) - General web interface guidelines
- [AI_FRONTEND.md](AI_FRONTEND.md) - Frontend architecture (React/TypeScript reference)
- [AI_WEB_DESIGN_SQOWE.md](AI_WEB_DESIGN_SQOWE.md) - sqowe brand design system

### File Size Rules

- JavaScript files: ~800 lines or less
- CSS: Separated by concern (base, layout, components)
- No inline styles or scripts in HTML

### Making Changes

1. Read the relevant AI*.md file for guidelines
2. Follow the established patterns and structure
3. Test in multiple browsers
4. Maintain accessibility (WCAG AA compliance)

## Troubleshooting

### EPG Data Not Loading

1. Check browser console for errors
2. Verify EPG URL is accessible in a browser
3. Confirm the file is gzipped
4. Try using a local web server
5. Check for CORS errors

### Search Not Working

1. Make sure EPG data is loaded first
2. Check browser console for JavaScript errors
3. Clear browser cache and reload

### Settings Not Saving

1. Check if localStorage is enabled in your browser
2. Check browser privacy settings
3. Try a different browser

## License

This is a personal project. Modify and use as needed.

## Support

For issues or questions, check:
- Browser console for error messages
- Network tab in Developer Tools
- EPG XML file format and structure
