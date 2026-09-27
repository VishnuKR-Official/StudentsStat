import re
with open('README.md', 'r', encoding='utf-8') as f:
    readme = f.read()

start = readme.find('## ')
# Find the Features section
match = re.search(r'## .*?Features.*?\n(.*?)\n---', readme, flags=re.DOTALL)
if match:
    old_features = match.group(1)
    new_features = """
- **🏆 52 Gamified Levels**: Track progress step-by-step from Level 1 all the way to Level 52.
- **🚀 Dynamic Milestone Track**: 
  - 🚀 **Rocket**: Just leveled up in the past 48 hours!
  - 🟢 **Active**: Updated level this week.
  - 🟡 / 🔴 **Stale Indicators**: Sinks down slightly if inactive for 1+ weeks to encourage momentum.
- **👥 Multiple Batches & Invite Links**: Create isolated rooms for different cohorts. Admins control entry via Invite Links and approve pending members.
- **💬 Real-Time Live Chat**: 
  - Global Batch Group Chat for announcements and banter.
  - **One-to-One DMs** for private messaging.
  - Complete with Unread Badges, Read Receipts (✓✓), Edit, and Delete (for me/everyone) capabilities.
  - Privacy-first: Messages self-destruct after 24 hours.
- **📱 PWA & Installable**: Acts as a native app on iOS, Android, and Desktop with offline caching for blazing fast loads. Just hit "Install App"!
- **🔔 Weekly Automated Reminders**: System automatically pings every batch every Monday morning at 10 AM to update their levels.
- **☁️ Real-Time Cloud Sync**: Powered by a hosted **Supabase PostgreSQL** database, so student data survives server restarts and redeploys.
"""
    readme = readme.replace(old_features, new_features)
    with open('README.md', 'w', encoding='utf-8') as f:
        f.write(readme)
