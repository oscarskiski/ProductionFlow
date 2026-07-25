import { Routes, Route, Navigate } from 'react-router-dom'
import LoginScreen from './screens/LoginScreen'
import DashboardScreen from './screens/DashboardScreen'
import PriorityScreen from './screens/PriorityScreen'
import ScheduleScreen from './screens/ScheduleScreen'
import ConstraintScreen from './screens/ConstraintScreen'
// Wood Conveyor hidden 2026-07-16 — re-enable by uncommenting this import + its route below
// import WoodConveyorScreen from './screens/WoodConveyorScreen'
import WeekPlanScreen from './screens/WeekPlanScreen'
import DispatchScreen from './screens/DispatchScreen'
import TrackingScreen from './screens/TrackingScreen'
import ProductsScreen from './screens/ProductsScreen'
import MachinesScreen from './screens/MachinesScreen'
import CostingScreen from './screens/CostingScreen'
import CustomersScreen from './screens/CustomersScreen'
import OptionsScreen from './screens/OptionsScreen'
import ImportScreen from './screens/ImportScreen'
import ReconcileScreen from './screens/ReconcileScreen'
import MESStationScreen from './screens/MESStationScreen'
import RoleGate from './components/RoleGate'
import DailyCheckModal from './components/DailyCheckModal'
import { MessagesProvider } from './store/MessagesContext'

function App() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F3EF' }}>
      <MessagesProvider>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/priority" element={<PriorityScreen />} />
        <Route path="/schedule" element={<ScheduleScreen />} />
        <Route path="/constraint" element={<ConstraintScreen />} />
        {/* Wood Conveyor hidden 2026-07-16 — re-enable by uncommenting (screen code still intact)
        <Route path="/wood-conveyor" element={
          <RoleGate allow={['Boss', 'Manager']}>
            <WoodConveyorScreen />
          </RoleGate>
        } /> */}
        <Route path="/week" element={<WeekPlanScreen />} />
        <Route path="/dispatch" element={<DispatchScreen />} />
        <Route path="/tracking" element={<TrackingScreen />} />
        <Route path="/products" element={
          <RoleGate allow={['Boss', 'Manager']}>
            <ProductsScreen />
          </RoleGate>
        } />
        <Route path="/machines" element={
          <RoleGate allow={['Boss', 'Manager']}>
            <MachinesScreen />
          </RoleGate>
        } />
        <Route path="/costing" element={
          <RoleGate allow={['Boss']}>
            <CostingScreen />
          </RoleGate>
        } />
        <Route path="/customers" element={
          <RoleGate allow={['Boss', 'Manager']}>
            <CustomersScreen />
          </RoleGate>
        } />
        <Route path="/options" element={
          <RoleGate allow={['Boss']}>
            <OptionsScreen />
          </RoleGate>
        } />
        <Route path="/import" element={
          <RoleGate allow={['Boss', 'Manager']}>
            <ImportScreen />
          </RoleGate>
        } />
        <Route path="/reconcile" element={
          <RoleGate allow={['Boss', 'Manager']}>
            <ReconcileScreen />
          </RoleGate>
        } />
        <Route path="/mes-station" element={<MESStationScreen />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
      <DailyCheckModal />
      </MessagesProvider>
    </div>
  )
}

export default App
