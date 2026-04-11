#!/usr/bin/env python3
import re

# Read the file
with open('src/pages/DebugDashboardPage.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the Item-Name SelectContent with max-height
# Look for the Item-Name section and its SelectContent
pattern = r'(<p className="text-xs font-medium text-muted-foreground">Item-Name</p>[\s\S]*?)<SelectContent>([\s\S]*?</SelectContent>)'

def replace_func(match):
    before = match.group(1)
    inside = match.group(2)
    return before + '<SelectContent className="max-h-[200px]">' + inside

content = re.sub(pattern, replace_func, content)

# Write back
with open('src/pages/DebugDashboardPage.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed SelectContent max-height")
