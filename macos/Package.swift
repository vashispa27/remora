// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Remora",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "RemoraCore", targets: ["RemoraCore"]),
        .executable(name: "Remora", targets: ["Remora"])
    ],
    targets: [
        .target(name: "RemoraCore"),
        .executableTarget(
            name: "Remora",
            dependencies: ["RemoraCore"]
        ),
        .testTarget(
            name: "RemoraCoreTests",
            dependencies: ["RemoraCore"]
        )
    ]
)
