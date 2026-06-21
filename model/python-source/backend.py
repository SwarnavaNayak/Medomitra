import os
import json
from typing import TypedDict, Optional, List
from langgraph.graph import StateGraph, END
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import tensorflow as tf
import joblib
import numpy as np
import google.generativeai as genai

# --- 1. Setup and Configuration ---
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY not found in .env file.")
genai.configure(api_key=api_key)

# Configure the generative model for consistent, high-quality output
generation_config = {
  "temperature": 0.2,
  "top_p": 1,
  "top_k": 32,
  "max_output_tokens": 4096,
}
llm_model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    generation_config=generation_config
)

# --- Initialize Flask App ---
app = Flask(__name__)
CORS(app)

# --- 2. Load ML Model ---
try:
    model = tf.keras.models.load_model("disease_model.h5")
    encoder = joblib.load("disease_encoder.pkl")
    print("TensorFlow model and encoder loaded successfully.")
except (IOError, tf.errors.NotFoundError) as e:
    print(f"FATAL ERROR: Could not load ML model or encoder: {e}")
    exit()

# --- 3. Define all symptoms ---
all_symptoms = ['abdominal_cramps', 'bloating', 'blurred_vision', 'body_ache',
                'change_in_urination', 'chest_pain', 'chills', 'cold_sweat',
                'confusion', 'constipation_or_diarrhea', 'continuous_sneezing',
                'cough', 'coughing', 'coughing_up_blood', 'cyclical_fever',
                'dehydration', 'diarrhea', 'dizziness', 'excessive_thirst',
                'extreme_fatigue', 'fatigue', 'fatigue_on_exertion', 'fever',
                'frequent_urination', 'head_congestion', 'headache',
                'high_blood_pressure', 'high_fever', 'increased_hunger',
                'irregular_heartbeat', 'itchy_eyes', 'joint_pain',
                'loss_of_appetite', 'mild_fever', 'muscle_ache', 'muscle_cramps',
                'muscle_pain', 'nasal_congestion', 'nausea', 'night_sweats',
                'nosebleeds', 'numbness_in_hands_or_feet', 'pain_behind_eyes',
                'palpitations', 'persistent_cough', 'profuse_sweating',
                'prolonged_cough', 'prolonged_high_fever', 'radiating_arm_pain',
                'rash', 'rash_of_flat_rose-colored_spots', 'runny_nose',
                'severe_fatigue', 'severe_headache', 'severe_muscle_ache',
                'shaking_chills', 'shortness_of_breath', 'skin_rash',
                'slow_healing_wounds', 'sneezing', 'sore_throat',
                'stomach_pain', 'sweating', 'swelling_ankles', 'swelling_in_legs',
                'unexplained_weight_loss', 'vomiting', 'watery_eyes', 'weakness']

# --- 4. Agent State (MODIFIED) ---
class AgentState(TypedDict):
    problem: Optional[str]
    duration: Optional[str]
    severity: Optional[str]
    location: Optional[str]
    age: Optional[str]
    gender: Optional[str]
    prediction: Optional[str]
    is_valid: bool
    # ADDED: Internal field to hold probability without polluting the final output
    top_probability: Optional[float] 

# --- 5. Pydantic Models for Structured LLM Output ---
class DiseasePrediction(BaseModel):
    disease: str = Field(..., description="The name of the possible disease.")
    reasoning: str = Field(..., description="A brief explanation of why this disease is considered, based on the symptoms.")
    confidence: str = Field(..., description="A confidence level, such as 'High', 'Medium', or 'Low'.")

class ApiResponse(BaseModel):
    predictions: List[DiseasePrediction]
    disclaimer: str = Field(..., description="A mandatory disclaimer for the user.")

# --- 6. Node Functions for the Agent ---
def extract_keyword_node(state: AgentState) -> AgentState:
    """Uses the LLM to intelligently extract relevant symptoms from natural language."""
    print("[Node] Running: extract_keyword_node")
    user_input = state.get("problem", "")
    print(f"  - Original input: '{user_input}'")
    if not user_input:
        print("  - Input is empty. No keywords to extract.")
        state["problem"] = ""
        return state
    symptom_list_str = ", ".join(all_symptoms)
    prompt = (
        "You are an expert medical symptom extractor. Your task is to analyze the user's text "
        "and identify symptoms that match a predefined list.\n\n"
        f"User's problem description:\n'{user_input}'\n\n"
        f"Here is the list of valid symptoms you must match against:\n{symptom_list_str}\n\n"
        "Review the user's description and extract all matching symptoms from the valid list. "
        "Return ONLY a comma-separated list of the valid symptom names you found. "
        "Example output: fever, headache, cough"
    )
    try:
        response = llm_model.generate_content(prompt)
        extracted_keywords = response.text.strip().lower().replace("`", "")
        state["problem"] = extracted_keywords
        print(f"  - LLM extracted symptoms: {extracted_keywords}")
    except Exception as e:
        print(f"  - ERROR during LLM extraction: {e}. Falling back to simple split.")
        state["problem"] = ", ".join([s.strip().lower() for s in user_input.split(',') if s.strip()])
    return state

def model_predict_node(state: AgentState) -> AgentState: # MODIFIED
    """Uses the local TensorFlow model to make a prediction."""
    print("[Node] Running: model_predict_node")
    symptoms_list = [s.strip() for s in state.get("problem", "").split(",") if s.strip()]
    user_input = [0] * len(all_symptoms)
    for s in symptoms_list:
        if s in all_symptoms:
            user_input[all_symptoms.index(s)] = 1
    if not any(user_input):
        print("  - No valid symptoms found for ML model. Skipping prediction.")
        state["prediction"] = "No matching symptoms for local model."
        state["top_probability"] = 0.0
        return state

    user_input_array = np.array([user_input])
    pred_probs = model.predict(user_input_array, verbose=0)[0]
    top_indices = pred_probs.argsort()[-3:][::-1]
    top_diseases = [(encoder.inverse_transform([i])[0], pred_probs[i]) for i in top_indices]
    
    # MODIFIED: Store probability internally and create a clean output string
    top_disease_name, top_prob_value = top_diseases[0]
    state["top_probability"] = top_prob_value * 100  # Store as percentage
    
    disease_names = [d for d, p in top_diseases]
    state["prediction"] = ", ".join(disease_names)

    print(f"  - ML model prediction (clean): {state['prediction']}")
    print(f"  - Internal top probability: {state['top_probability']:.1f}%")
    return state

def validation_node(state: AgentState) -> dict: # MODIFIED
    """Validates if the top prediction is confident enough by reading from the state."""
    print("[Node] Running: validation_node")
    
    # MODIFIED: Read probability directly from the agent's state
    top_prob = state.get("top_probability", 0.0)
    is_valid = top_prob > 50.0 # Confidence threshold, adjusted for clarity
    
    print(f"  - Reading top probability: {top_prob:.1f}%. Prediction valid? {is_valid}")
    state["is_valid"] = is_valid
    return {"is_valid": is_valid}

def api_predict_node(state: AgentState) -> AgentState:
    """Falls back to the advanced LLM for a reasoned prediction and formats a simple output."""
    print("[Node] Running: api_predict_node (LLM Fallback)")
    symptom_details = {key: state.get(key) for key in ['problem', 'duration', 'severity', 'location', 'age', 'gender'] if state.get(key)}
    symptom_details_json = json.dumps(symptom_details, indent=2)

    prompt = f"""
    You are an expert medical diagnostic AI assistant. Your task is to provide a differential diagnosis based on patient details.
    **Instructions:**
    1.  **Analyze Patient Data:** Carefully review all the provided patient details.
    2.  **Generate Hypotheses:** Based on the analysis, formulate three plausible medical conditions.
    3.  **Provide Reasoning:** For each hypothesis, briefly explain which symptoms from the patient's data support your conclusion.
    4.  **Assign Confidence:** Indicate a confidence level (High, Medium, Low) for each hypothesis.
    5.  **Include Disclaimer:** You MUST include a disclaimer stating that this is not a medical diagnosis and the user should consult a healthcare professional.
    6.  **Format Output:** Respond ONLY with a valid JSON object that strictly follows this structure: {ApiResponse.model_json_schema()}
    **Patient Data:**
    {symptom_details_json}
    """
    try:
        response = llm_model.generate_content(prompt)
        text = response.text.strip().replace("```json", "").replace("```", "")
        parsed_response = ApiResponse.model_validate_json(text)
        
        disease_names = [pred.disease for pred in parsed_response.predictions]
        final_prediction = "\n".join(disease_names)
        
        state["prediction"] = final_prediction
        print(f"  - Successfully generated LLM prediction. Final Output:\n{final_prediction}")
    except Exception as e:
        state["prediction"] = f"Error: The AI could not generate a prediction. Please try rephrasing your symptoms."
        print(f"  - ERROR during LLM prediction: {e}")
    return state

def decide_next_step(state: AgentState) -> str:
    """Decides whether to end the graph or call the LLM fallback."""
    print("[Router] Deciding next step...")
    if state.get("is_valid", False):
        print("  - Path: END")
        return END
    else:
        print("  - Path: api_predict")
        return "api_predict"

# --- 7. Build the Agent Graph ---
workflow = StateGraph(AgentState)
workflow.add_node("extract_keywords", extract_keyword_node)
workflow.add_node("model_predict", model_predict_node)
workflow.add_node("validate", validation_node)
workflow.add_node("api_predict", api_predict_node)

workflow.set_entry_point("extract_keywords")
workflow.add_edge("extract_keywords", "model_predict")
workflow.add_edge("model_predict", "validate")
workflow.add_conditional_edges("validate", decide_next_step, {END: END, "api_predict": "api_predict"})
workflow.add_edge("api_predict", END)

agent_graph = workflow.compile()
print("Agent graph compiled successfully.")

# --- 8. Flask Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route("/api/predict", methods=["POST"])
def predict():
    data = request.get_json()
    if not data or "problem" not in data:
        return jsonify({"error": "Missing 'problem' in request"}), 400

    initial_state = {key: data.get(key) for key in ["problem", "duration", "severity", "location", "age", "gender"]}
    initial_state["is_valid"] = False
    initial_state["top_probability"] = 0.0

    print("\n--- New Prediction Request ---")
    final_state = agent_graph.invoke(initial_state)
    print("--- Request Finished ---\n")
    
    return jsonify({"prediction": final_state.get("prediction", "N/A")})

# --- 9. Run Server ---
if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)

