import httpx
import json
from typing import Optional, Dict, Any

from app.models.agent import Agent


class AgentService:
    """Service to handle AI agent responses using external APIs"""

    async def generate_response(
        self,
        agent: Agent,
        user_message: str,
        sender_name: str,
        group_name: str
    ) -> Optional[str]:
        """
        Generate a response using the agent's configured API

        Args:
            agent: The Agent model with API configuration
            user_message: The message content to respond to
            sender_name: Name of the person who sent the message
            group_name: Name of the group where the message was sent

        Returns:
            The generated response text, or None if failed
        """
        try:
            # Build the system prompt with context
            system_prompt = agent.system_prompt or "You are a helpful assistant."

            # Add context about the conversation
            context = f"You are responding to a message in the WhatsApp group '{group_name}'. "
            context += f"The message was sent by '{sender_name}'. "
            context += "Keep your response concise and friendly for a chat environment."

            full_system_prompt = f"{system_prompt}\n\n{context}"

            # Prepare the request based on the API URL (detect API type)
            if "generativelanguage.googleapis.com" in agent.api_url:
                return await self._call_gemini_api(agent, full_system_prompt, user_message)
            elif "openai.com" in agent.api_url or "api.openai" in agent.api_url:
                return await self._call_openai_api(agent, full_system_prompt, user_message)
            else:
                # Default to Gemini-style API
                return await self._call_gemini_api(agent, full_system_prompt, user_message)

        except Exception as e:
            print(f"[AGENT] Error generating response: {e}")
            return None

    async def _call_gemini_api(
        self,
        agent: Agent,
        system_prompt: str,
        user_message: str
    ) -> Optional[str]:
        """Call Google Gemini API"""
        try:
            # Build the API URL with key
            url = f"{agent.api_url}?key={agent.api_key}"

            # Prepare the request payload
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": f"{system_prompt}\n\nUser message: {user_message}"}
                        ]
                    }
                ],
                "generationConfig": {
                    "maxOutputTokens": agent.output_token_limit or 1024,
                    "temperature": 0.7
                }
            }

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=60.0
                )

                if response.status_code == 200:
                    data = response.json()
                    # Extract text from Gemini response
                    if "candidates" in data and len(data["candidates"]) > 0:
                        candidate = data["candidates"][0]
                        if "content" in candidate and "parts" in candidate["content"]:
                            parts = candidate["content"]["parts"]
                            if len(parts) > 0 and "text" in parts[0]:
                                return parts[0]["text"]

                    print(f"[AGENT] Gemini response structure unexpected: {data}")
                    return None
                else:
                    print(f"[AGENT] Gemini API error: {response.status_code} - {response.text}")
                    return None

        except Exception as e:
            print(f"[AGENT] Gemini API call failed: {e}")
            return None

    async def _call_openai_api(
        self,
        agent: Agent,
        system_prompt: str,
        user_message: str
    ) -> Optional[str]:
        """Call OpenAI-compatible API"""
        try:
            payload = {
                "model": "gpt-3.5-turbo",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                "max_tokens": agent.output_token_limit or 1024,
                "temperature": 0.7
            }

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    agent.api_url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {agent.api_key}"
                    },
                    timeout=60.0
                )

                if response.status_code == 200:
                    data = response.json()
                    if "choices" in data and len(data["choices"]) > 0:
                        return data["choices"][0]["message"]["content"]

                    print(f"[AGENT] OpenAI response structure unexpected: {data}")
                    return None
                else:
                    print(f"[AGENT] OpenAI API error: {response.status_code} - {response.text}")
                    return None

        except Exception as e:
            print(f"[AGENT] OpenAI API call failed: {e}")
            return None


# Singleton instance
agent_service = AgentService()
