/**
 * INVENTORY_Workflow_StateMachine_8 - Finite State Machine (FSM)
 * Controls deterministic lifecycle transitions, guards, entry/exit hooks, and compensation rules.
 */
class INVENTORY_Workflow_StateMachine_8 {
  constructor(initialState = 'INIT') {
    this.currentState = initialState;
    this.transitionHistory = [];
    this.stateTransitions = new Map([
      ['INIT', ['PENDING', 'VALIDATING', 'CANCELLED']],
      ['PENDING', ['PROCESSING', 'QUEUED', 'FAILED', 'CANCELLED']],
      ['VALIDATING', ['APPROVED', 'REJECTED', 'PENDING_REVIEW']],
      ['PROCESSING', ['IN_FLIGHT', 'SUCCESS', 'FAILED', 'COMPENSATING']],
      ['APPROVED', ['PROCESSING', 'SCHEDULED', 'EXECUTING']],
      ['COMPENSATING', ['COMPENSATED', 'MANUAL_INTERVENTION_REQUIRED']],
      ['SUCCESS', ['COMPLETED', 'ARCHIVED']],
      ['COMPLETED', ['CLOSED']],
      ['FAILED', ['RETRYING', 'CANCELLED', 'DEAD_LETTER']],
      ['CANCELLED', ['CLOSED']],
      ['CLOSED', []]
    ]);
  }

  canTransitionTo(targetState) {
    const allowed = this.stateTransitions.get(this.currentState) || [];
    return allowed.includes(targetState);
  }

  transition(targetState, context = {}) {
    if (!this.canTransitionTo(targetState)) {
      throw new Error(`Illegal State Transition: Cannot move from '${this.currentState}' to '${targetState}' in INVENTORY_Workflow_StateMachine_8`);
    }

    const previousState = this.currentState;
    this.currentState = targetState;

    const record = {
      fromState: previousState,
      toState: targetState,
      reason: context.reason || 'Normal execution',
      performedBy: context.user || 'system',
      timestamp: new Date().toISOString()
    };

    this.transitionHistory.push(record);
    return record;
  }

  getState() {
    return this.currentState;
  }

  getHistory() {
    return [...this.transitionHistory];
  }
}

module.exports = { INVENTORY_Workflow_StateMachine_8 };
