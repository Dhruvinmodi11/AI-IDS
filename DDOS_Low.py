from scapy.all import sniff
from collections import Counter
from datetime import datetime

# Configuration: Set a threshold for number of packets per second to consider as a potential attack
THRESHOLD = 100  # Example value, adjust based on your network traffic

packet_counts = Counter()

def detect_ddos(pkt):
    # We track the packets by source IP address to see if there is a surge in traffic from particular IPs
    if pkt.haslayer('IP'):
        packet_counts.update([pkt['IP'].src])
        
        # Output the current packet count per IP every second
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{current_time}] {pkt['IP'].src} => {pkt['IP'].dst}: {packet_counts[pkt['IP'].src]} packets")

        # Check if the number of packets from any source IP has exceeded the threshold
        for ip, count in packet_counts.items():
            if count > THRESHOLD:
                print(f"Potential DDoS attack detected from IP: {ip}")

# Start sniffing the network.
sniff(filter="ip", prn=detect_ddos, store=False)

# Note: You will need to run this script with administrative privileges.
