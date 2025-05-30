const { getPrompt } = require('../services/promptService');
const { getLlmFeedback } = require('../services/llmService');
const Session = require('../models/Session');
const testCaptureManager = require('../models/testCapture/TestCaptureManager');

// Store active sessions in memory (replace with proper storage in production)
const sessions = new Map();

exports.newSession = (req, res) => {
  // Create a new session for FizzBuzz kata
  const sessionId = Date.now().toString();
  const session = new Session('fizzbuzz');
  sessions.set(sessionId, session);
  
  res.render('session', {
    sessionId,
    state: session.state,
    testCases: session.testCases,
    productionCode: session.productionCode,
    testCode: session.testCode,
    feedback: "Welcome to the FizzBuzz kata! Let's get started with TDD.",
    selectedTestIndex: null,
    proceed: null, // No proceed value for initial welcome message
    tokenUsage: session.tokenUsage.getStats(),
    isTestingModeEnabled: testCaptureManager.isTestingModeEnabled()
  });
};

exports.submitCode = async (req, res) => {
  const { sessionId, productionCode, testCode, selectedTestIndex } = req.body;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).send('Session not found');
  }
  
  // Update session with latest code
  session.productionCode = productionCode;
  session.testCode = testCode;
  
  // Store the selected test index if in PICK state
  if (session.state === 'PICK' && selectedTestIndex !== undefined) {
    session.selectedTestIndex = selectedTestIndex;
  }
  
  // Get appropriate prompt for current state
  const prompt = getPrompt(session);
  
  try {
    // Get LLM feedback with token tracking
    const feedback = await getLlmFeedback(prompt, session.tokenUsage);
    
    // Capture interaction if test capture mode is enabled
    if (testCaptureManager.isTestingModeEnabled()) {
      testCaptureManager.captureInteraction({
        state: session.state,
        productionCode: session.productionCode,
        testCode: session.testCode,
        testCases: session.testCases,
        selectedTestIndex: session.selectedTestIndex,
        currentTestIndex: session.currentTestIndex,
        llmResponse: feedback
      });
    }
    
    // Process feedback and update session state if needed
    if (session.processSubmission(feedback) && feedback.proceed === 'yes') {
      session.advanceState();
    }
    
    // Render updated view
    res.render('session', {
      sessionId,
      state: session.state,
      testCases: session.testCases,
      productionCode: session.productionCode,
      testCode: session.testCode,
      feedback: feedback.comments,
      selectedTestIndex: session.selectedTestIndex,
      proceed: feedback.proceed, // Pass proceed value to the view
      tokenUsage: session.tokenUsage.getStats(),
      isTestingModeEnabled: testCaptureManager.isTestingModeEnabled()
    });
  } catch (error) {
    console.error('Error getting LLM feedback:', error);
    res.status(500).send('Error processing your submission');
  }
};

exports.getHint = async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).send('Session not found');
  }
  
  // Get appropriate prompt for current state
  const prompt = getPrompt(session);
  
  try {
    // Get LLM hint with token tracking
    const feedback = await getLlmFeedback(prompt, session.tokenUsage);
    
    // Return the hint and the proceed value for styling
    res.json({ 
      hint: feedback.hint,
      proceed: feedback.proceed 
    });
  } catch (error) {
    console.error('Error getting hint:', error);
    res.status(500).send('Error getting hint');
  }
};

exports.restartSession = (req, res) => {
  const { sessionId } = req.body;
  
  // Create a fresh session
  const session = new Session('fizzbuzz');
  sessions.set(sessionId, session);
  
  res.render('session', {
    sessionId,
    state: session.state,
    testCases: session.testCases,
    productionCode: session.productionCode,
    testCode: session.testCode,
    feedback: "Session restarted. Let's begin again!",
    selectedTestIndex: null,
    proceed: null, // No proceed value for restart message
    tokenUsage: session.tokenUsage.getStats(),
    isTestingModeEnabled: testCaptureManager.isTestingModeEnabled()
  });
};