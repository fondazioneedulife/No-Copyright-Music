import re

with open('frontend/src/components/AdminDiagnosticsPanel.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def insert_at(lines, line_num, text):
    lines.insert(line_num - 1, text + '\n')

# We go in reverse order to avoid shifting line numbers!

# 5. Wrap log part 2 (594-605) -> Actually ends at 605, starts at 594.
# wait, line 607 is </article>
insert_at(lines, 607, '      </>\n      )}')
insert_at(lines, 594, '      {activeTab === "log" && (\n      <>')

# 4. Wrap audit part 2 (557-592)
insert_at(lines, 593, '      </>\n      )}')
insert_at(lines, 557, '      {activeTab === "audit" && (\n      <>')

# 3. Wrap log part 1 (509-555)
insert_at(lines, 556, '      </>\n      )}')
insert_at(lines, 509, '      {activeTab === "log" && (\n      <>')

# 2. Wrap audit part 1 (359-507)
insert_at(lines, 508, '      </>\n      )}')
insert_at(lines, 359, '      {activeTab === "audit" && (\n      <>')

# 1. Wrap youtube (347-357)
insert_at(lines, 358, '      </>\n      )}')
insert_at(lines, 347, '      {activeTab === "youtube" && (\n      <>')

# 0. Close stato at 346 (starts at 113)
insert_at(lines, 346, '      </>\n      )}')

with open('frontend/src/components/AdminDiagnosticsPanel.jsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)
