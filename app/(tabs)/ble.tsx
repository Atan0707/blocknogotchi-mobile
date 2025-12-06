import { requestPermissions } from "@/hooks/useBLE";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
    const [savedDevices, setSavedDevices] = useState<{id: string, name: string, isConnected: boolean}[]>([]); // Saved/known devices

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

    // Load saved devices on mount
    useEffect(() => {
        const loadSavedDevices = async () => {
            try {
                const saved = await AsyncStorage.getItem("savedBLEDevices");
                if (saved) {
                    const parsed = JSON.parse(saved);
                    setSavedDevices(parsed);
                }
            } catch (error) {
                console.error("Failed to load saved devices:", error);
            }
        };
        loadSavedDevices();
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

    // Note: Connection status is updated when connecting/disconnecting
    // We can't reliably check connection status without scanning

    // Save device to saved list
    const saveDevice = useCallback(async (device: Device) => {
        const deviceInfo = {
            id: device.id,
            name: device.name || "Unknown Device",
            isConnected: false,
        };

        const updated = [...savedDevices];
        const existingIndex = updated.findIndex(d => d.id === device.id);
        
        if (existingIndex >= 0) {
            updated[existingIndex] = { ...updated[existingIndex], name: deviceInfo.name };
        } else {
            updated.push(deviceInfo);
        }

        setSavedDevices(updated);
        try {
            await AsyncStorage.setItem("savedBLEDevices", JSON.stringify(updated));
        } catch (error) {
            console.error("Failed to save device:", error);
        }
    }, [savedDevices]);

    // Remove device from saved list
    const removeSavedDevice = useCallback(async (deviceId: string) => {
        const updated = savedDevices.filter(d => d.id !== deviceId);
        setSavedDevices(updated);
        try {
            await AsyncStorage.setItem("savedBLEDevices", JSON.stringify(updated));
        } catch (error) {
            console.error("Failed to remove device:", error);
        }
    }, [savedDevices]);

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

            // Save device to saved list
            await saveDevice(device);

            // Update saved devices connection status
            setSavedDevices(prev => prev.map(d => 
                d.id === device.id ? { ...d, isConnected: true } : { ...d, isConnected: false }
            ));

            // Set up disconnection listener
            connected.onDisconnected(() => {
                setConnectedDevice(null);
                setServices([]);
                setCharacteristics([]);
                // Update saved devices connection status
                setSavedDevices(prev => prev.map(d => 
                    d.id === device.id ? { ...d, isConnected: false } : d
                ));
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
    }, [bleManager, saveDevice]);

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
                // Update saved devices connection status
                setSavedDevices(prev => prev.map(d => 
                    d.id === connectedDevice.id ? { ...d, isConnected: false } : d
                ));
            } catch (error: any) {
                Alert.alert("Error", error.message || "Failed to disconnect");
            }
        }
    }, [connectedDevice]);

    // Connect to saved device by ID (requires device to be in scanned list)
    const connectToSavedDevice = useCallback(async (deviceId: string) => {
        if (!bleManager) {
            Alert.alert("Error", "BLE Manager not initialized");
            return;
        }

        // Try to find device in currently scanned devices
        const foundDevice = [...devices, ...allDevices].find(d => d.id === deviceId);
        
        if (foundDevice) {
            await connectToDevice(foundDevice);
        } else {
            Alert.alert(
                "Device Not Found", 
                "Device is not in range. Please scan for devices first, then try connecting."
            );
        }
    }, [bleManager, connectToDevice, devices, allDevices]);

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

                    {/* Saved Devices Section */}
                    {savedDevices.length > 0 && (
                        <View style={styles.savedSection}>
                            <Text style={styles.sectionTitle}>Saved Devices ({savedDevices.length})</Text>
                            {savedDevices.map((saved) => (
                                <View key={saved.id} style={styles.deviceCard}>
                                    <View style={styles.deviceHeader}>
                                        <View style={styles.deviceInfo}>
                                            <Text style={styles.deviceName}>{saved.name}</Text>
                                            <Text style={styles.deviceId}>ID: {saved.id}</Text>
                                        </View>
                                        <View style={styles.statusBadge}>
                                            <View style={[
                                                styles.statusDot, 
                                                saved.isConnected ? styles.statusConnected : styles.statusDisconnected
                                            ]} />
                                            <Text style={[
                                                styles.statusText,
                                                saved.isConnected ? styles.statusTextConnected : styles.statusTextDisconnected
                                            ]}>
                                                {saved.isConnected ? "Connected" : "Disconnected"}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.deviceActions}>
                                        <TouchableOpacity
                                            style={[styles.actionButton, saved.isConnected && styles.buttonDisabled]}
                                            onPress={() => connectToSavedDevice(saved.id)}
                                            disabled={saved.isConnected || isConnecting}
                                        >
                                            <Text style={styles.buttonText}>
                                                {saved.isConnected ? "Connected" : "Connect"}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.actionButton, styles.buttonRemove]}
                                            onPress={() => removeSavedDevice(saved.id)}
                                        >
                                            <Text style={styles.buttonText}>Remove</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

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
                                
                                const isSaved = savedDevices.some(d => d.id === device.id);
                                const savedDeviceInfo = savedDevices.find(d => d.id === device.id);
                                // Note: connectedDevice is null in this block, so we only check saved device status
                                const isCurrentlyConnected = savedDeviceInfo ? savedDeviceInfo.isConnected : false;

                                return (
                                <View key={device.id} style={styles.deviceCard}>
                                    <View style={styles.deviceHeader}>
                                        <View style={styles.deviceInfo}>
                                            <Text style={styles.deviceName}>
                                                {device.name || "Unknown Device"}
                                            </Text>
                                            <Text style={styles.deviceId}>ID: {device.id}</Text>
                                            {device.rssi && (
                                                <Text style={styles.deviceRssi}>
                                                    RSSI: {device.rssi} dBm
                                                </Text>
                                            )}
                                            {isSaved && (
                                                <Text style={styles.savedBadge}>Saved</Text>
                                            )}
                                        </View>
                                        {isCurrentlyConnected && (
                                            <View style={styles.statusBadge}>
                                                <View style={[styles.statusDot, styles.statusConnected]} />
                                                <Text style={[styles.statusText, styles.statusTextConnected]}>
                                                    Connected
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                    {device.manufacturerData && (
                                        <Text style={styles.deviceData}>
                                            Manufacturer Data: {device.manufacturerData}
                                        </Text>
                                    )}
                                    {isRaspberryPi ? (
                                        <View style={styles.deviceActions}>
                                            <TouchableOpacity
                                                style={[styles.connectButton, isCurrentlyConnected && styles.buttonDisabled]}
                                                onPress={() => connectToDevice(device)}
                                                disabled={isConnecting || isCurrentlyConnected}
                                            >
                                                <Text style={styles.buttonText}>
                                                    {isCurrentlyConnected ? "Connected" : isConnecting ? "Connecting..." : "Connect"}
                                                </Text>
                                            </TouchableOpacity>
                                            {!isSaved && (
                                                <TouchableOpacity
                                                    style={[styles.actionButton, styles.buttonSave]}
                                                    onPress={() => saveDevice(device)}
                                                >
                                                    <Text style={styles.buttonText}>Save</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
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
    savedSection: {
        marginBottom: 20,
    },
    deviceCard: {
        backgroundColor: "#F5F5F5",
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
    },
    deviceHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 8,
    },
    deviceInfo: {
        flex: 1,
    },
    deviceName: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 4,
    },
    savedBadge: {
        fontSize: 10,
        color: "#007AFF",
        fontWeight: "600",
        marginTop: 4,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusConnected: {
        backgroundColor: "#34C759",
    },
    statusDisconnected: {
        backgroundColor: "#8E8E93",
    },
    statusText: {
        fontSize: 12,
        fontWeight: "600",
    },
    statusTextConnected: {
        color: "#34C759",
    },
    statusTextDisconnected: {
        color: "#8E8E93",
    },
    deviceActions: {
        flexDirection: "row",
        gap: 8,
        marginTop: 8,
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
        flex: 1,
        alignItems: "center",
    },
    buttonSave: {
        backgroundColor: "#007AFF",
    },
    buttonRemove: {
        backgroundColor: "#FF3B30",
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
