import { requestPermissions } from "@/hooks/useBLE";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

export default function BLEScreen() {
    const bleManagerRef = useRef<BleManager | null>(null);
    const [bleManager, setBleManager] = useState<BleManager | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [permissionsGranted, setPermissionsGranted] = useState(false);

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
        setError(null);
        setIsScanning(true);

        bleManager.startDeviceScan(null, null, (error, device) => {
            if (error) {
                setError(error.message);
                setIsScanning(false);
                return;
            }

            if (device) {
                setDevices((prevDevices) => {
                    // Avoid duplicates by checking if device already exists
                    const exists = prevDevices.some((d) => d.id === device.id);
                    if (!exists) {
                        return [...prevDevices, device];
                    }
                    return prevDevices;
                });
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

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>BLE Device Scanner</Text>
                <Text style={styles.status}>
                    {isScanning ? "Scanning..." : "Stopped"}
                </Text>
                {error && <Text style={styles.error}>Error: {error}</Text>}
                {!permissionsGranted && (
                    <Text style={styles.warning}>Permissions not granted</Text>
                )}
            </View>

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
                <Text style={styles.devicesTitle}>
                    Found Devices ({devices.length})
                </Text>
            </View>

            <ScrollView style={styles.devicesList}>
                {devices.length === 0 ? (
                    <Text style={styles.emptyText}>
                        {isScanning
                            ? "Scanning for devices..."
                            : "No devices found. Press 'Start Scan' to begin."}
                    </Text>
                ) : (
                    devices.map((device) => (
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
                        </View>
                    ))
                )}
            </ScrollView>
        </View>
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
    devicesTitle: {
        fontSize: 18,
        fontWeight: "600",
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
});
