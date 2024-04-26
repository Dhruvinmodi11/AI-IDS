import random
import time
import csv
from datetime import datetime

# Define the characteristics of a botnet attack
botnet_characteristics = {
    "PacketLenMean": [40, 800],
    "MaxPacketLen": [40, 1500],
    "InitWinBytesBwd": [100, 10000],
    "BwdPacketLenMax": [40, 1500],
    "AvgBwdSegmentSize": [40, 800],
    "PSHFlagCount": [0, 1]
}

# Function to simulate botnet traffic characteristics
def simulate_botnet_attack():
    return {
        "PacketLenMean": random.uniform(*botnet_characteristics["PacketLenMean"]),
        "MaxPacketLen": random.uniform(*botnet_characteristics["MaxPacketLen"]),
        "InitWinBytesBwd": random.uniform(*botnet_characteristics["InitWinBytesBwd"]),
        "BwdPacketLenMax": random.uniform(*botnet_characteristics["BwdPacketLenMax"]),
        "AvgBwdSegmentSize": random.uniform(*botnet_characteristics["AvgBwdSegmentSize"]),
        "PSHFlagCount": random.randint(*botnet_characteristics["PSHFlagCount"])
    }

# Main function to run the simulation
def run_simulation(duration_seconds):
    start_time = time.time()
    with open('botnet_simulation_log.csv', 'w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=botnet_characteristics.keys())
        writer.writeheader()
        
        # Run the simulation for the given duration
        while time.time() - start_time < duration_seconds:
            attack_data = simulate_botnet_attack()
            writer.writerow(attack_data)
            print(f"Simulated botnet traffic at {datetime.now()}: {attack_data}")
            time.sleep(1)  # Pause for 1 second between simulations

# Run the simulation for 60 seconds (or any other duration you wish)
run_simulation(60)
