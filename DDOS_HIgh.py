from scapy.all import sniff
from collections import Counter
from datetime import datetime

# Threshold configuration
LOW_THRESHOLD = 50  # Example value, adjust based on your network traffic
MEDIUM_THRESHOLD = 100
HIGH_THRESHOLD = 200  # These values are arbitrary examples

packet_counts = Counter()

def detect_ddos(pkt):
    # We track the packets by source IP address to see if there is a surge in traffic from particular IPs
    if pkt.haslayer('IP'):
        packet_counts.update([pkt['IP'].src])
        
        # Get the current time
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # Check for each IP if the number of packets exceeds the threshold
        for ip, count in packet_counts.items():
            if count > HIGH_THRESHOLD:
                risk_level = "HIGH RISK"
            elif count > MEDIUM_THRESHOLD:
                risk_level = "MEDIUM RISK"
            elif count > LOW_THRESHOLD:
                risk_level = "LOW RISK"
            else:
                risk_level = "NO RISK"
            
            print(f"[{current_time}] {ip} sent {count} packets. Risk level: {risk_level}")

# Start sniffing the network.
sniff(filter="ip", prn=detect_ddos, store=False)

# Note: You will need to run this script with administrative privileges.
