import json
import math
import os
import re
import numpy as np

# Optional pandas import
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

# -----------------------------------------------------------------------------
# 1. Custom TF-IDF Class (No sklearn dependency)
# -----------------------------------------------------------------------------
class CustomTfidf:
    def __init__(self, stop_words=None):
        self.stop_words = stop_words or {
            'the', 'a', 'an', 'is', 'it', 'in', 'on', 'of', 'for', 'to', 'and', 
            'or', 'with', 'this', 'that', 'by', 'from', 'at', 'be', 'are', 'was', 
            'were', 'your', 'our', 'my', 'have', 'has', 'had', 'you', 'we', 'will', 
            'can', 'should', 'all', 'more', 'new', 'get', 'not', 'if', 'so', 'as', 
            'but', 'they', 'their', 'them', 'who', 'which', 'what', 'when', 'where'
        }
        self.vocabulary = {}
        self.feature_names = []
        self.idf = []
        self.N = 0

    def _tokenize(self, text):
        text = text.lower()
        tokens = re.findall(r'\b[a-z0-9]{2,}\b', text)
        return [t for t in tokens if t not in self.stop_words]

    def fit_transform(self, documents):
        self.N = len(documents)
        tokenized_docs = [self._tokenize(doc) for doc in documents]

        # Build vocabulary
        vocab_set = set()
        for doc in tokenized_docs:
            vocab_set.update(doc)
        
        self.feature_names = sorted(list(vocab_set))
        self.vocabulary = {word: idx for idx, word in enumerate(self.feature_names)}
        V = len(self.feature_names)

        # Document frequencies (df)
        df = [0] * V
        for doc in tokenized_docs:
            unique_words = set(doc)
            for w in unique_words:
                df[self.vocabulary[w]] += 1

        # Compute IDF: log((N + 1) / (df + 1)) + 1
        self.idf = np.array([math.log((self.N + 1) / (df_val + 1)) + 1.0 for df_val in df])

        # Build dense TF-IDF matrix
        A = np.zeros((self.N, V), dtype=np.float64)
        for doc_idx, doc in enumerate(tokenized_docs):
            word_counts = {}
            for w in doc:
                word_counts[w] = word_counts.get(w, 0) + 1

            for w, count in word_counts.items():
                if w in self.vocabulary:
                    col_idx = self.vocabulary[w]
                    tf = math.log(1 + count)
                    A[doc_idx, col_idx] = tf * self.idf[col_idx]

            # Row L2-normalization
            norm = np.linalg.norm(A[doc_idx])
            if norm > 0:
                A[doc_idx] /= norm

        return A

    def transform(self, documents):
        V = len(self.feature_names)
        tokenized_docs = [self._tokenize(doc) for doc in documents]
        A = np.zeros((len(documents), V), dtype=np.float64)

        for doc_idx, doc in enumerate(tokenized_docs):
            word_counts = {}
            for w in doc:
                word_counts[w] = word_counts.get(w, 0) + 1

            for w, count in word_counts.items():
                if w in self.vocabulary:
                    col_idx = self.vocabulary[w]
                    tf = math.log(1 + count)
                    A[doc_idx, col_idx] = tf * self.idf[col_idx]

            norm = np.linalg.norm(A[doc_idx])
            if norm > 0:
                A[doc_idx] /= norm

        return A


# -----------------------------------------------------------------------------
# 2. Main SVD Engine Execution
# -----------------------------------------------------------------------------
def run_engine():
    data_path = "../data/sample_emails.json"
    if not os.path.exists(data_path):
        data_path = "email_categorizer/data/sample_emails.json"

    with open(data_path, "r") as f:
        emails = json.load(f)

    print(f"Loaded {len(emails)} emails.")

    # Combine subject and body for text vectorization
    corpus = [f"{e['subject']} {e['body']}" for e in emails]

    # Custom TF-IDF
    tfidf = CustomTfidf()
    A = tfidf.fit_transform(corpus)
    print(f"TF-IDF Matrix Shape: {A.shape}")

    # Manual Truncated SVD using np.linalg.svd
    U, S, Vt = np.linalg.svd(A, full_matrices=False)
    k = min(50, A.shape[0], A.shape[1])
    V_k = Vt[:k, :].T  # (V x k)

    # Document representations in SVD space
    X_svd = A @ V_k  # (N x k)

    # Normalize SVD vectors
    norms = np.linalg.norm(X_svd, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X_svd = X_svd / norms

    # Seed words for 4 categories
    seed_dict = {
        "Education": ["syllabus", "lecture", "assignment", "campus", "course", "homework", "exam", "university", "professor", "student", "grade", "class", "academic", "study", "library", "lab", "thesis"],
        "Work": ["invoice", "meeting", "client", "q4", "project", "deadline", "report", "presentation", "team", "agenda", "schedule", "manager", "sprint", "contract", "review", "okr", "deliverables"],
        "Finance": ["transaction", "balance", "mortgage", "stock", "bank", "payment", "credit", "account", "transfer", "interest", "statement", "tax", "loan", "debit", "dividend", "escrow", "wire"],
        "Promotions": ["sale", "discount", "coupon", "newsletter", "deal", "offer", "shop", "free", "clearance", "promo", "buy", "limited", "vip", "reward", "voucher", "flash", "apparel"]
    }

    centroids = {}
    for cat, seeds in seed_dict.items():
        seed_text = " ".join(seeds)
        seed_vec = tfidf.transform([seed_text])
        svd_centroid = seed_vec @ V_k
        c_norm = np.linalg.norm(svd_centroid)
        if c_norm > 0:
            svd_centroid /= c_norm
        centroids[cat] = svd_centroid[0].tolist()

    # Compute similarity and predictions
    cat_names = list(centroids.keys())
    centroid_matrix = np.array([centroids[cat] for cat in cat_names])  # (4 x k)

    # Similarity matrix: (N x 4)
    sim_matrix = X_svd @ centroid_matrix.T

    predictions = []
    confidences = []
    correct = 0

    for i, email in enumerate(emails):
        scores = sim_matrix[i]
        best_idx = np.argmax(scores)
        best_cat = cat_names[best_idx]
        conf = float(scores[best_idx])

        # Bounded confidence (0.0 to 1.0)
        conf_bounded = max(0.0, min(1.0, conf))

        email["assigned_category"] = best_cat
        email["confidence"] = round(conf_bounded, 4)
        email["svd_vector"] = X_svd[i].tolist()

        predictions.append(best_cat)
        confidences.append(f"{round(conf_bounded * 100, 1)}%")

        if email.get("true_category") == best_cat:
            correct += 1

    acc = (correct / len(emails)) * 100
    print(f"\nAccuracy vs Ground Truth: {acc:.2f}% ({correct}/{len(emails)})")

    # Output Validation Table Preview
    print("\n--- Validation Table (First 20 Held-out Emails) ---")
    if HAS_PANDAS:
        df_eval = pd.DataFrame({
            "Email Subject": [e["subject"][:45] for e in emails[:20]],
            "True Category": [e.get("true_category", "N/A") for e in emails[:20]],
            "Assigned Category": predictions[:20],
            "Confidence": confidences[:20]
        })
        print(df_eval.to_string(index=False))
    else:
        header = f"{'Email Subject':<48} | {'True Cat':<10} | {'Assigned Cat':<12} | {'Confidence':<10}"
        print(header)
        print("-" * len(header))
        for i in range(min(20, len(emails))):
            subj = emails[i]["subject"][:45] + ("..." if len(emails[i]["subject"]) > 45 else "")
            true_c = emails[i].get("true_category", "N/A")
            pred_c = predictions[i]
            conf_str = confidences[i]
            print(f"{subj:<48} | {true_c:<10} | {pred_c:<12} | {conf_str:<10}")

    # Save artifacts to extension/assets
    assets_dir = "email_categorizer/extension/assets"
    os.makedirs(assets_dir, exist_ok=True)

    np.save(os.path.join(assets_dir, "centroids.npy"), np.array([centroids[cat] for cat in cat_names]))
    with open(os.path.join(assets_dir, "centroids.json"), "w") as f:
        json.dump(centroids, f, indent=2)

    with open(os.path.join(assets_dir, "email_metadata.json"), "w") as f:
        json.dump(emails, f, indent=2)

    print(f"\nArtifacts successfully exported to {assets_dir}/")

if __name__ == "__main__":
    run_engine()
