import { requestPermissions } from "@/hooks/useBLE";
import { Buffer } from "buffer";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BleManager, Characteristic, Device, Service } from "react-native-ble-plx";

// UUIDs matching the Raspberry Pi server
const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const CHAR_UUID = "12345678-1234-1234-1234-123456789abd";

export default function BLEScreen() {
    const bleManagerRef = useRef<BleManager | null>(null);
    const [bleManager, setBleManager] = useState<BleManager | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [permissionsGranted, setPermissionsGranted] = useState(false);
    
    // Connection state
    const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [characteristics, setCharacteristics] = useState<Characteristic[]>([]);
    const [readValue, setReadValue] = useState<string>("");
    const [writeValue, setWriteValue] = useState<string>("");
    const [showAllDevices, setShowAllDevices] = useState<boolean>(false); // Debug mode
    const [allDevices, setAllDevices] = useState<Device[]>([]); // All scanned devices for debugging

    // Initialize BLE manager after mount
    useEffect(() => {
        try {
            const manager = new BleManager();
            bleManagerRef.current = manager;
            setBleManager(manager);
        } catch (err) {
            console.error("Failed to initialize BLE manager:", err);
            setError("Failed to initialize Bluetooth. Make sure Bluetooth is enabled.");
        }

        return () => {
            if (bleManagerRef.current) {
                bleManagerRef.current.destroy();
            }
        };
    }, []);

    // Request permissions on mount
    useEffect(() => {
        const checkPermissions = async () => {
            const granted = await requestPermissions();
            setPermissionsGranted(granted);
            if (!granted) {
                Alert.alert(
                    "Permissions Required",
                    "Bluetooth permissions are required to scan for devices."
                );
            }
        };
        checkPermissions();
    }, []);

    const startScan = useCallback(() => {
        if (!permissionsGranted) {
            Alert.alert("Permissions Required", "Please grant Bluetooth permissions first.");
            return;
        }

        if (!bleManager) {
            Alert.alert("Bluetooth Error", "Bluetooth manager is not initialized.");
            return;
        }

        setDevices([]);
        setAllDevices([]);
        setError(null);
        setIsScanning(true);

        // Scan for all devices, then filter by name/service UUID
        // Note: Service UUID filtering in startDeviceScan might be too restrictive
        // if the UUID isn't in the advertisement data
        bleManager.startDeviceScan(null, null, (error, device) => {
            if (error) {
                setError(error.message);
                setIsScanning(false);
                return;
            }

            if (device) {
                const deviceName = device.name || "";
                const deviceNameLower = deviceName.toLowerCase();
                
                // Store all devices for debugging
                setAllDevices((prevAll) => {
                    const exists = prevAll.some((d) => d.id === device.id);
                    if (!exists) {
                        return [...prevAll, device];
                    }
                    return prevAll;
                });

                // Debug logging
                console.log(`Found device: ${deviceName || "Unknown"} (${device.id})`);
                console.log(`  - Service UUIDs: ${device.serviceUUIDs?.join(", ") || "None"}`);
                console.log(`  - RSSI: ${device.rssi || "N/A"}`);
                console.log(`  - Manufacturer Data: ${device.manufacturerData || "None"}`);
                
                // Check if device name matches Raspberry Pi
                // Also check serviceUUIDs if available in advertisement
                // Check MAC address pattern (Raspberry Pi MACs often start with B8:27:EB, DC:A6:32, E4:5F:01, or D8:3A:DD)
                const deviceId = device.id.toLowerCase();
                const isRaspberryPi = 
                    deviceNameLower.includes("raspberry") ||
                    deviceNameLower.includes("raspberrypi") ||
                    deviceNameLower.includes("harizpi") ||
                    deviceId.includes("d8:3a:dd") || // Your Pi's MAC prefix
                    deviceId.includes("b8:27:eb") || // Common Pi MAC prefix
                    deviceId.includes("dc:a6:32") || // Common Pi MAC prefix
                    deviceId.includes("e4:5f:01") || // Common Pi MAC prefix
                    (device.serviceUUIDs && device.serviceUUIDs.length > 0 && device.serviceUUIDs.some(
                        uuid => uuid.toLowerCase() === SERVICE_UUID.toLowerCase()
                    ));

                if (isRaspberryPi) {
                    console.log(`✓ Raspberry Pi detected: ${deviceName || device.id}`);
                    setDevices((prevDevices) => {
                        // Avoid duplicates by checking if device already exists
                        const exists = prevDevices.some((d) => d.id === device.id);
                        if (!exists) {
                            return [...prevDevices, device];
                        }
                        return prevDevices;
                    });
                }
            }
        });
    }, [bleManager, permissionsGranted]);

    const stopScan = useCallback(() => {
        if (bleManager) {
            bleManager.stopDeviceScan();
        }
        setIsScanning(false);
    }, [bleManager]);

    const clearDevices = useCallback(() => {
        setDevices([]);
        setError(null);
    }, []);

    // Connect to a device
    const connectToDevice = useCallback(async (device: Device) => {
        if (!bleManager) {
            Alert.alert("Error", "BLE Manager not initialized");
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            // Stop scanning before connecting
            await bleManager.stopDeviceScan();
            setIsScanning(false);

            // Connect to device
            const connected = await device.connect();
            setConnectedDevice(connected);

            // Set up disconnection listener
            connected.onDisconnected(() => {
                setConnectedDevice(null);
                setServices([]);
                setCharacteristics([]);
                Alert.alert("Disconnected", "Device disconnected");
            });

            // Discover services and characteristics
            const deviceWithServices = await connected.discoverAllServicesAndCharacteristics();
            
            // Get all services
            const allServices = await deviceWithServices.services();
            setServices(allServices);

            // Get characteristics for our service
            if (allServices.length > 0) {
                const service = allServices.find(s => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase());
                if (service) {
                    const allCharacteristics = await service.characteristics();
                    setCharacteristics(allCharacteristics);
                } else {
                    // If service not found, get characteristics from first service
                    const firstService = allServices[0];
                    const allCharacteristics = await firstService.characteristics();
                    setCharacteristics(allCharacteristics);
                }
            }

            Alert.alert("Success", `Connected to ${device.name || device.id}`);
        } catch (error: any) {
            Alert.alert("Connection Error", error.message || "Failed to connect");
            setConnectedDevice(null);
            setError(error.message || "Connection failed");
        } finally {
            setIsConnecting(false);
        }
    }, [bleManager]);

    // Disconnect from device
    const disconnectDevice = useCallback(async () => {
        if (connectedDevice) {
            try {
                await connectedDevice.cancelConnection();
                setConnectedDevice(null);
                setServices([]);
                setCharacteristics([]);
                setReadValue("");
                setWriteValue("");
            } catch (error: any) {
                Alert.alert("Error", error.message || "Failed to disconnect");
            }
        }
    }, [connectedDevice]);

    // Read from characteristic
    const readCharacteristic = useCallback(async () => {
        if (!connectedDevice || characteristics.length === 0) {
            Alert.alert("Error", "Not connected or no characteristics available");
            return;
        }

        try {
            // Find the characteristic matching our UUID
            const char = characteristics.find(
                c => c.uuid.toLowerCase() === CHAR_UUID.toLowerCase()
            ) || characteristics[0];

            const value = await char.read();
            const decoded = value.value ? Buffer.from(value.value, 'base64').toString('utf-8') : "No data";
            setReadValue(decoded);
            Alert.alert("Read Success", `Value: ${decoded}`);
        } catch (error: any) {
            Alert.alert("Read Error", error.message || "Failed to read");
            setError(error.message || "Read failed");
        }
    }, [connectedDevice, characteristics]);

    // Write to characteristic
    const writeCharacteristic = useCallback(async () => {
        if (!connectedDevice || characteristics.length === 0) {
            Alert.alert("Error", "Not connected or no characteristics available");
            return;
        }

        if (!writeValue.trim()) {
            Alert.alert("Error", "Please enter a value to write");
            return;
        }

        try {
            // Find the characteristic matching our UUID
            const char = characteristics.find(
                c => c.uuid.toLowerCase() === CHAR_UUID.toLowerCase()
            ) || characteristics[0];

            const base64 = Buffer.from(writeValue).toString('base64');
            await char.writeWithResponse(base64);
            Alert.alert("Success", "Data written successfully");
            setWriteValue("");
        } catch (error: any) {
            Alert.alert("Write Error", error.message || "Failed to write");
            setError(error.message || "Write failed");
        }
    }, [connectedDevice, characteristics, writeValue]);

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>BLE Device Scanner</Text>
                <Text style={styles.status}>
                    {connectedDevice 
                        ? `Connected: ${connectedDevice.name || connectedDevice.id}`
                        : isScanning 
                        ? "Scanning..." 
                        : "Stopped"}
                </Text>
                {error && <Text style={styles.error}>Error: {error}</Text>}
                {!permissionsGranted && (
                    <Text style={styles.warning}>Permissions not granted</Text>
                )}
            </View>

            {!connectedDevice ? (
                <>
                    <View style={styles.controls}>
                        <TouchableOpacity
                            style={[styles.button, isScanning && styles.buttonDisabled]}
                            onPress={startScan}
                            disabled={isScanning}
                        >
                            <Text style={styles.buttonText}>Start Scan</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.button, !isScanning && styles.buttonDisabled]}
                            onPress={stopScan}
                            disabled={!isScanning}
                        >
                            <Text style={styles.buttonText}>Stop Scan</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.button, styles.buttonSecondary]}
                            onPress={clearDevices}
                        >
                            <Text style={styles.buttonText}>Clear</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.devicesHeader}>
                        <View style={styles.headerRow}>
                            <Text style={styles.devicesTitle}>
                                {showAllDevices ? `All Devices (${allDevices.length})` : `Raspberry Pi Devices (${devices.length})`}
                            </Text>
                            <TouchableOpacity
                                style={styles.debugButton}
                                onPress={() => setShowAllDevices(!showAllDevices)}
                            >
                                <Text style={styles.debugButtonText}>
                                    {showAllDevices ? "Show Pi Only" : "Show All"}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.devicesList}>
                        {(showAllDevices ? allDevices : devices).length === 0 ? (
                            <Text style={styles.emptyText}>
                                {isScanning
                                    ? showAllDevices 
                                        ? "Scanning for all devices..."
                                        : "Scanning for Raspberry Pi..."
                                    : showAllDevices
                                        ? "No devices found. Press 'Start Scan' to begin."
                                        : "No Raspberry Pi found. Press 'Start Scan' to begin."}
                            </Text>
                        ) : (
                            (showAllDevices ? allDevices : devices).map((device) => {
                                const deviceName = device.name || "";
                                const deviceNameLower = deviceName.toLowerCase();
                                const deviceId = device.id.toLowerCase();
                                const isRaspberryPi = 
                                    deviceNameLower.includes("raspberry") ||
                                    deviceNameLower.includes("raspberrypi") ||
                                    deviceNameLower.includes("harizpi") ||
                                    deviceId.includes("d8:3a:dd") || // Your Pi's MAC prefix
                                    deviceId.includes("b8:27:eb") || // Common Pi MAC prefix
                                    deviceId.includes("dc:a6:32") || // Common Pi MAC prefix
                                    deviceId.includes("e4:5f:01") || // Common Pi MAC prefix
                                    (device.serviceUUIDs && device.serviceUUIDs.length > 0 && device.serviceUUIDs.some(
                                        uuid => uuid.toLowerCase() === SERVICE_UUID.toLowerCase()
                                    ));
                                
                                return (
                                <View key={device.id} style={styles.deviceCard}>
                                    <Text style={styles.deviceName}>
                                        {device.name || "Unknown Device"}
                                    </Text>
                                    <Text style={styles.deviceId}>ID: {device.id}</Text>
                                    {device.rssi && (
                                        <Text style={styles.deviceRssi}>
                                            RSSI: {device.rssi} dBm
                                        </Text>
                                    )}
                                    {device.manufacturerData && (
                                        <Text style={styles.deviceData}>
                                            Manufacturer Data: {device.manufacturerData}
                                        </Text>
                                    )}
                                    {isRaspberryPi ? (
                                        <TouchableOpacity
                                            style={styles.connectButton}
                                            onPress={() => connectToDevice(device)}
                                            disabled={isConnecting}
                                        >
                                            <Text style={styles.buttonText}>
                                                {isConnecting ? "Connecting..." : "Connect"}
                                            </Text>
                                        </TouchableOpacity>
                                    ) : showAllDevices ? (
                                        <Text style={styles.notPiText}>Not a Raspberry Pi</Text>
                                    ) : null}
                                </View>
                                );
                            })
                        )}
                    </View>
                </>
            ) : (
                <>
                    <View style={styles.controls}>
                        <TouchableOpacity
                            style={[styles.button, styles.buttonDanger]}
                            onPress={disconnectDevice}
                        >
                            <Text style={styles.buttonText}>Disconnect</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.connectionSection}>
                        <Text style={styles.sectionTitle}>Services & Characteristics</Text>
                        {services.length > 0 && (
                            <View style={styles.infoCard}>
                                <Text style={styles.infoText}>
                                    Services: {services.length}
                                </Text>
                                <Text style={styles.infoText}>
                                    Characteristics: {characteristics.length}
                                </Text>
                            </View>
                        )}

                        <Text style={styles.sectionTitle}>Read Characteristic</Text>
                        <View style={styles.readSection}>
                            <TextInput
                                style={styles.readInput}
                                value={readValue}
                                placeholder="Read value will appear here"
                                editable={false}
                                multiline
                            />
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={readCharacteristic}
                            >
                                <Text style={styles.buttonText}>Read</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.sectionTitle}>Write Characteristic</Text>
                        <View style={styles.writeSection}>
                            <TextInput
                                style={styles.writeInput}
                                value={writeValue}
                                onChangeText={setWriteValue}
                                placeholder="Enter text to send..."
                                multiline
                            />
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={writeCharacteristic}
                            >
                                <Text style={styles.buttonText}>Write</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#fff",
        padding: 16,
    },
    header: {
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: "bold",
        marginBottom: 8,
    },
    status: {
        fontSize: 16,
        color: "#666",
        marginBottom: 4,
    },
    error: {
        fontSize: 14,
        color: "#ff0000",
        marginTop: 4,
    },
    warning: {
        fontSize: 14,
        color: "#ff8800",
        marginTop: 4,
    },
    controls: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 20,
        gap: 8,
    },
    button: {
        flex: 1,
        backgroundColor: "#007AFF",
        padding: 12,
        borderRadius: 8,
        alignItems: "center",
    },
    buttonSecondary: {
        backgroundColor: "#8E8E93",
    },
    buttonDisabled: {
        backgroundColor: "#CCCCCC",
    },
    buttonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "600",
    },
    devicesHeader: {
        marginBottom: 12,
    },
    headerRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    devicesTitle: {
        fontSize: 18,
        fontWeight: "600",
        flex: 1,
    },
    debugButton: {
        backgroundColor: "#8E8E93",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    debugButtonText: {
        color: "#fff",
        fontSize: 12,
        fontWeight: "600",
    },
    notPiText: {
        fontSize: 12,
        color: "#999",
        fontStyle: "italic",
        marginTop: 8,
    },
    devicesList: {
        flex: 1,
    },
    emptyText: {
        textAlign: "center",
        color: "#999",
        marginTop: 40,
        fontSize: 16,
    },
    deviceCard: {
        backgroundColor: "#F5F5F5",
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
    },
    deviceName: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 4,
    },
    deviceId: {
        fontSize: 12,
        color: "#666",
        marginBottom: 4,
        fontFamily: "monospace",
    },
    deviceRssi: {
        fontSize: 12,
        color: "#666",
        marginBottom: 4,
    },
    deviceData: {
        fontSize: 12,
        color: "#666",
        marginTop: 4,
    },
    connectButton: {
        backgroundColor: "#34C759",
        padding: 10,
        borderRadius: 6,
        marginTop: 8,
        alignItems: "center",
    },
    buttonDanger: {
        backgroundColor: "#FF3B30",
    },
    connectionSection: {
        marginTop: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: "600",
        marginTop: 20,
        marginBottom: 12,
    },
    infoCard: {
        backgroundColor: "#E8F5E9",
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    infoText: {
        fontSize: 14,
        color: "#2E7D32",
        marginBottom: 4,
    },
    readSection: {
        marginBottom: 20,
    },
    readInput: {
        backgroundColor: "#F5F5F5",
        borderWidth: 1,
        borderColor: "#DDD",
        borderRadius: 8,
        padding: 12,
        minHeight: 60,
        fontSize: 14,
        marginBottom: 8,
    },
    writeSection: {
        marginBottom: 20,
    },
    writeInput: {
        backgroundColor: "#FFF",
        borderWidth: 1,
        borderColor: "#007AFF",
        borderRadius: 8,
        padding: 12,
        minHeight: 60,
        fontSize: 14,
        marginBottom: 8,
    },
    actionButton: {
        backgroundColor: "#007AFF",
        padding: 12,
        borderRadius: 8,
        alignItems: "center",
    },
});
