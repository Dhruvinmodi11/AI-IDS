import webbrowser
import time
import random

# List of safe websites to open
websites = [
    "https://www.google.com",
    "https://www.wikipedia.org",
    "https://www.github.com",
    "https://www.stackoverflow.com",
    "https://www.reddit.com",
]

# Time interval in seconds
interval = 1

try:
    while True:
        # Randomly select a website from the list
        site = random.choice(websites)
        
        # Open the website in a new browser tab
        webbrowser.open_new_tab(site)
        
        # Print which site was opened
        print(f"Opened: {site}")
        
        # Wait for the specified time interval
        time.sleep(interval)

except KeyboardInterrupt:
    print("Script stopped by user.")
