import { db, vehiclesTable, ridersTable, assignmentsTable, dailyLogsTable, attendanceTable, maintenanceTable } from "@workspace/db";

async function seed() {
  console.log("Seeding database...");

  const vehicles = await db.insert(vehiclesTable).values([
    { vehicleNumber: "V001", plateNumber: "BP02-05BPA3", vehicleType: "Electric Scooter", brand: "NIU", model: "NQi GT", manufactureYear: 2024, color: "White", status: "active", purchaseDate: "2024-06-15", purchaseCost: "350000", batteryDetails: "72V 26Ah Lithium", insuranceExpiry: "2026-06-15", taxExpiry: "2026-06-15", odometerReading: "12500", locationBranch: "Kathmandu" },
    { vehicleNumber: "V002", plateNumber: "BP03-05BPA7", vehicleType: "Electric Scooter", brand: "Yadea", model: "G5", manufactureYear: 2024, color: "Black", status: "active", purchaseDate: "2024-07-20", purchaseCost: "280000", batteryDetails: "60V 20Ah Lithium", insuranceExpiry: "2026-07-20", taxExpiry: "2026-07-20", odometerReading: "9800", locationBranch: "Kathmandu" },
    { vehicleNumber: "V003", plateNumber: "BP01-04BPA5", vehicleType: "Electric Scooter", brand: "NIU", model: "MQi+", manufactureYear: 2023, color: "Red", status: "active", purchaseDate: "2023-11-10", purchaseCost: "320000", batteryDetails: "48V 31Ah Lithium", insuranceExpiry: "2025-11-10", taxExpiry: "2025-11-10", odometerReading: "22300", locationBranch: "Lalitpur" },
    { vehicleNumber: "V004", plateNumber: "BP04-06BPA2", vehicleType: "Electric Scooter", brand: "Yadea", model: "T5", manufactureYear: 2024, color: "Blue", status: "maintenance", purchaseDate: "2024-03-05", purchaseCost: "260000", batteryDetails: "60V 20Ah Lithium", insuranceExpiry: "2026-03-05", taxExpiry: "2026-03-05", odometerReading: "15600", locationBranch: "Bhaktapur" },
    { vehicleNumber: "V005", plateNumber: "BP02-07BPA9", vehicleType: "Electric Scooter", brand: "NIU", model: "NQi GT", manufactureYear: 2024, color: "Silver", status: "active", purchaseDate: "2024-08-01", purchaseCost: "355000", batteryDetails: "72V 26Ah Lithium", insuranceExpiry: "2026-08-01", taxExpiry: "2026-08-01", odometerReading: "7200", locationBranch: "Kathmandu" },
    { vehicleNumber: "V006", plateNumber: "BP05-03BPA1", vehicleType: "Electric Scooter", brand: "Yadea", model: "G5", manufactureYear: 2023, color: "Green", status: "inactive", purchaseDate: "2023-09-15", purchaseCost: "275000", batteryDetails: "60V 20Ah Lithium", insuranceExpiry: "2025-09-15", taxExpiry: "2025-09-15", odometerReading: "28400", locationBranch: "Lalitpur" },
  ]).returning();

  const riders = await db.insert(ridersTable).values([
    { fullName: "Ram Bahadur Tamang", phoneNumber: "9841234567", secondaryPhone: "9801234567", citizenshipNumber: "27-01-77-12345", licenseNumber: "DL-2024-001234", licenseExpiryDate: "2029-06-15", address: "Thamel, Kathmandu", emergencyContact: "9841234568", joiningDate: "2024-07-01", employmentType: "full_time", monthlySalary: "25000", dailyRideTarget: 25, assignedSupervisor: "Supervisor A", securityDeposit: "10000", status: "active" },
    { fullName: "Sita Kumari Shrestha", phoneNumber: "9841234568", citizenshipNumber: "27-01-78-22345", licenseNumber: "DL-2024-002345", licenseExpiryDate: "2029-08-20", address: "Patan, Lalitpur", emergencyContact: "9841234569", joiningDate: "2024-08-15", employmentType: "full_time", monthlySalary: "25000", dailyRideTarget: 23, assignedSupervisor: "Supervisor A", securityDeposit: "10000", status: "active" },
    { fullName: "Bikash Gurung", phoneNumber: "9841234569", citizenshipNumber: "27-01-79-33456", licenseNumber: "DL-2023-003456", licenseExpiryDate: "2028-11-10", address: "Bhaktapur", emergencyContact: "9841234570", joiningDate: "2024-01-10", employmentType: "full_time", monthlySalary: "22000", dailyRideTarget: 20, assignedSupervisor: "Supervisor B", securityDeposit: "8000", status: "active" },
    { fullName: "Anita Rai", phoneNumber: "9841234570", citizenshipNumber: "27-01-80-44567", licenseNumber: "DL-2024-004567", licenseExpiryDate: "2029-03-05", address: "Baneshwor, Kathmandu", emergencyContact: "9841234571", joiningDate: "2024-09-01", employmentType: "part_time", monthlySalary: "18000", dailyRideTarget: 15, assignedSupervisor: "Supervisor B", securityDeposit: "5000", status: "active" },
    { fullName: "Prakash Maharjan", phoneNumber: "9841234571", citizenshipNumber: "27-01-81-55678", licenseNumber: "DL-2023-005678", licenseExpiryDate: "2028-09-15", address: "Kirtipur, Kathmandu", emergencyContact: "9841234572", joiningDate: "2023-12-01", employmentType: "full_time", monthlySalary: "25000", dailyRideTarget: 25, assignedSupervisor: "Supervisor A", securityDeposit: "10000", status: "inactive" },
  ]).returning();

  await db.insert(assignmentsTable).values([
    { riderId: riders[0].id, vehicleId: vehicles[0].id, startDate: "2024-07-01", shiftType: "day", status: "active" },
    { riderId: riders[1].id, vehicleId: vehicles[1].id, startDate: "2024-08-15", shiftType: "day", status: "active" },
    { riderId: riders[2].id, vehicleId: vehicles[2].id, startDate: "2024-01-10", shiftType: "morning", status: "active" },
    { riderId: riders[3].id, vehicleId: vehicles[4].id, startDate: "2024-09-01", shiftType: "evening", status: "active" },
  ]);

  const dailyLogData = [];
  const dates = [
    { en: "2025-12-26", np: "Poush 11" },
    { en: "2025-12-28", np: "Poush 13" },
    { en: "2025-12-29", np: "Poush 14" },
    { en: "2025-12-30", np: "Poush 15" },
    { en: "2025-12-31", np: "Poush 16" },
    { en: "2026-01-01", np: "Poush 17" },
    { en: "2026-01-02", np: "Poush 18" },
    { en: "2026-01-03", np: "Poush 19" },
    { en: "2026-01-04", np: "Poush 20" },
    { en: "2026-01-05", np: "Poush 21" },
    { en: "2026-01-06", np: "Poush 22" },
    { en: "2026-01-07", np: "Poush 23" },
    { en: "2026-01-08", np: "Poush 24" },
    { en: "2026-01-09", np: "Poush 25" },
    { en: "2026-01-12", np: "Poush 28" },
    { en: "2026-01-13", np: "Poush 29" },
    { en: "2026-01-15", np: "Magh 1" },
    { en: "2026-01-16", np: "Magh 2" },
    { en: "2026-01-17", np: "Magh 3" },
    { en: "2026-01-19", np: "Magh 5" },
    { en: "2026-01-20", np: "Magh 6" },
    { en: "2026-01-21", np: "Magh 7" },
    { en: "2026-01-22", np: "Magh 8" },
    { en: "2026-01-25", np: "Magh 11" },
    { en: "2026-01-26", np: "Magh 12" },
    { en: "2026-01-27", np: "Magh 13" },
    { en: "2026-01-29", np: "Magh 15" },
  ];

  for (const d of dates) {
    const ridesReceived = Math.floor(Math.random() * 30) + 20;
    const completed = Math.floor(ridesReceived * (0.4 + Math.random() * 0.3));
    const acceptance = ((completed / ridesReceived) * 100).toFixed(2);
    const bonusSet = Math.floor(Math.random() * 30) + 15;
    const bonusHit = completed >= bonusSet;
    const distance = (completed * (2 + Math.random() * 3)).toFixed(1);
    const cashApp = (completed * (35 + Math.random() * 30)).toFixed(2);
    const goalBonus = bonusHit ? (Math.floor(Math.random() * 200) + 800).toFixed(2) : "0";
    const promoBonus = (Math.random() * 150).toFixed(2);
    const totalIncome = (parseFloat(cashApp) + parseFloat(goalBonus) + parseFloat(promoBonus)).toFixed(2);
    const cashByDriver = (parseFloat(totalIncome) * 0.6).toFixed(2);
    const cashOnline = (parseFloat(totalIncome) * 0.3).toFixed(2);
    const cashCheck = (parseFloat(totalIncome) - parseFloat(cashByDriver) - parseFloat(cashOnline)).toFixed(2);

    dailyLogData.push({
      riderId: riders[0].id,
      vehicleId: vehicles[0].id,
      nepaliDate: d.np,
      englishDate: d.en,
      checkInTime: "6:00 AM",
      checkOutTime: "7:00 PM",
      dailyBonusSet: bonusSet,
      totalRidesReceived: ridesReceived,
      ridesCompleted: completed,
      acceptanceRate: acceptance,
      bonusTargetCompletion: bonusHit,
      totalRideDistanceKm: distance,
      totalRideHours: "4:30",
      totalAppOnline: "10:30",
      cashAsPerApp: cashApp,
      goalBonus,
      promotionBonusOther: promoBonus,
      totalIncome,
      cashGivenByDriver: cashByDriver,
      cashTransferredOnline: cashOnline,
      cashCheck,
      dailyAllowance: "200.00",
      additionalExpenses: "0",
      remarks: "",
    });
  }

  for (let i = 0; i < 15; i++) {
    const d = dates[i];
    const ridesReceived = Math.floor(Math.random() * 25) + 18;
    const completed = Math.floor(ridesReceived * (0.35 + Math.random() * 0.35));
    const acceptance = ((completed / ridesReceived) * 100).toFixed(2);
    const bonusSet = Math.floor(Math.random() * 25) + 15;
    const bonusHit = completed >= bonusSet;
    const distance = (completed * (2 + Math.random() * 3)).toFixed(1);
    const cashApp = (completed * (35 + Math.random() * 30)).toFixed(2);
    const goalBonus = bonusHit ? (Math.floor(Math.random() * 200) + 700).toFixed(2) : "0";
    const promoBonus = (Math.random() * 120).toFixed(2);
    const totalIncome = (parseFloat(cashApp) + parseFloat(goalBonus) + parseFloat(promoBonus)).toFixed(2);
    const cashByDriver = (parseFloat(totalIncome) * 0.55).toFixed(2);
    const cashOnline = (parseFloat(totalIncome) * 0.35).toFixed(2);
    const cashCheck = (parseFloat(totalIncome) - parseFloat(cashByDriver) - parseFloat(cashOnline)).toFixed(2);

    dailyLogData.push({
      riderId: riders[1].id,
      vehicleId: vehicles[1].id,
      nepaliDate: d.np,
      englishDate: d.en,
      checkInTime: "7:00 AM",
      checkOutTime: "6:00 PM",
      dailyBonusSet: bonusSet,
      totalRidesReceived: ridesReceived,
      ridesCompleted: completed,
      acceptanceRate: acceptance,
      bonusTargetCompletion: bonusHit,
      totalRideDistanceKm: distance,
      totalRideHours: "3:45",
      totalAppOnline: "9:00",
      cashAsPerApp: cashApp,
      goalBonus,
      promotionBonusOther: promoBonus,
      totalIncome,
      cashGivenByDriver: cashByDriver,
      cashTransferredOnline: cashOnline,
      cashCheck,
      dailyAllowance: "200.00",
      additionalExpenses: "0",
      remarks: "",
    });
  }

  await db.insert(dailyLogsTable).values(dailyLogData);

  const attendanceData = [];
  const attendanceTypes: Array<"present" | "absent" | "leave" | "holiday" | "half_day"> = ["present", "absent", "leave", "holiday", "half_day"];
  for (const rider of riders.slice(0, 4)) {
    for (const d of dates.slice(0, 20)) {
      const rand = Math.random();
      let type: typeof attendanceTypes[number] = "present";
      if (rand > 0.85) type = "absent";
      else if (rand > 0.8) type = "leave";
      else if (rand > 0.75) type = "half_day";
      attendanceData.push({
        riderId: rider.id,
        date: d.en,
        nepaliDate: d.np,
        type,
      });
    }
  }
  await db.insert(attendanceTable).values(attendanceData);

  await db.insert(maintenanceTable).values([
    { vehicleId: vehicles[0].id, maintenanceType: "battery_service", date: "2025-11-15", cost: "5000", description: "Battery health check and cell balancing", nextServiceDate: "2026-05-15" },
    { vehicleId: vehicles[1].id, maintenanceType: "tire_replacement", date: "2025-12-01", cost: "3500", description: "Front tire replacement", nextServiceDate: "2026-06-01" },
    { vehicleId: vehicles[2].id, maintenanceType: "brake_service", date: "2025-10-20", cost: "2000", description: "Brake pad replacement", nextServiceDate: "2026-04-20" },
    { vehicleId: vehicles[3].id, maintenanceType: "electrical_repair", date: "2026-01-10", cost: "8000", description: "Controller unit replacement", nextServiceDate: "2026-07-10" },
    { vehicleId: vehicles[0].id, maintenanceType: "tire_replacement", date: "2025-09-05", cost: "4000", description: "Rear tire replacement", nextServiceDate: "2026-03-05" },
  ]);

  console.log("Seeding complete!");
  console.log(`  Vehicles: ${vehicles.length}`);
  console.log(`  Riders: ${riders.length}`);
  console.log(`  Daily Logs: ${dailyLogData.length}`);
  console.log(`  Attendance Records: ${attendanceData.length}`);
  console.log(`  Maintenance Records: 5`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
