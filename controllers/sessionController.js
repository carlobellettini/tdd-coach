const { getPrompt } = require('../services/promptService');
const { getLlmFeedback } = require('../services/llmService');
const Session = require('../models/Session');
const testCaptureManager = require('../models/testCapture/TestCaptureManager');
const { v4: uuidv4 } = require('uuid');
const katas = require('../models/katas');

// Store active sessions in memory (replace with proper storage in production)
const sessions = new Map();

// Export sessions map for test capture controller
exports.sessions = sessions;

exports.newSession = (req, res) => {
  // Get the FizzBuzz kata object
  const fizzbuzzKata = katas['fizzbuzz'];
  if (!fizzbuzzKata) {
    return res.status(404).send('FizzBuzz kata not found');
  }
  
  // Create a new session with the FizzBuzz kata object
  const sessionId = uuidv4();
  const session = new Session(fizzbuzzKata);
  sessions.set(sessionId, session);

  // Redirect to the session URL with ID
  res.redirect(`/session/${sessionId}`);
};

// Helper function to prepare session view data
const getSessionViewData = (sessionId, session, feedback = null, proceed = null) => {
  // Check if there's a previous LLM interaction
  const lastInteraction = session.getLastLlmInteraction();

  // Use last interaction feedback if available and no new feedback provided
  if (!feedback && lastInteraction && lastInteraction.llmResponse) {
    feedback = lastInteraction.llmResponse.comments;
    proceed = lastInteraction.llmResponse.proceed;
  }

  return {
    sessionId,
    state: session.state,
    stateDescription: session.getStateDescription(),
    testCases: session.testCases,
    productionCode: session.productionCode,
    testCode: session.testCode,
    feedback: feedback || session.feedback || "Welcome to the FizzBuzz kata! Let's get started with TDD.",
    selectedTestIndex: session.selectedTestIndex,
    proceed: proceed,
    tokenUsage: session.tokenUsage.getStats(),
    isPromptCaptureModeEnabled: testCaptureManager.isPromptCaptureModeEnabled()
  };
};

exports.getSession = (req, res) => {
  const sessionId = req.params.id;
  const session = sessions.get(sessionId);

  if (!session) {
    // Session not found, redirect to create a new one
    return res.redirect('/session/new');
  }

  const viewData = getSessionViewData(sessionId, session);
  res.render('session', viewData);
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

    // Always capture the last LLM interaction, regardless of capture mode
    const interactionData = {
      state: session.state,
      productionCode: session.productionCode,
      testCode: session.testCode,
      testCases: session.testCases,
      selectedTestIndex: session.selectedTestIndex,
      currentTestIndex: session.currentTestIndex,
      llmResponse: feedback
    };

    session.captureLastLlmInteraction(interactionData);

    // Capture interaction for test case creation if capture mode is enabled
    if (testCaptureManager.isPromptCaptureModeEnabled()) {
      session.captureInteraction(interactionData);
    }

    // Process feedback and update session state if needed
    if (session.processSubmission(feedback) && feedback.proceed === 'yes') {
      session.advanceState();
    }

    // Render updated view
    const viewData = getSessionViewData(sessionId, session, feedback.comments, feedback.proceed);
    res.render('session', viewData);
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

    // Capture this interaction as well
    const interactionData = {
      state: session.state,
      productionCode: session.productionCode,
      testCode: session.testCode,
      testCases: session.testCases,
      selectedTestIndex: session.selectedTestIndex,
      currentTestIndex: session.currentTestIndex,
      llmResponse: feedback,
      isHintRequest: true
    };

    session.captureLastLlmInteraction(interactionData);

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

  // Get the FizzBuzz kata object
  const fizzbuzzKata = katas['fizzbuzz'];
  if (!fizzbuzzKata) {
    return res.status(500).send('FizzBuzz kata not found');
  }

  // Create a fresh session
  const oldSession = sessions.get(sessionId);
  const newSession = new Session(fizzbuzzKata);
  newSession.tokenUsage = oldSession.tokenUsage; // Keep the same token usage tracker
  sessions.set(sessionId, newSession);

  const viewData = getSessionViewData(sessionId, newSession, "Session restarted. Let's begin again!", null);
  res.render('session', viewData);
};
